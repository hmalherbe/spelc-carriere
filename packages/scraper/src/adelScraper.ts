import { chromium, type Page } from "playwright";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Automates the manual export documented by the Spelc: log into ADEL (the union's own membership
 * database, hosted by Bayard Service), open the "outils de recherche" query tool for a given
 * CCMA/CCMI campaign, filter by Spelc name, and download the resulting Excel export — the exact
 * same file a human would otherwise save by hand.
 *
 * This is a best-effort port of a manual click-path described by the Spelc, not something we could
 * inspect live (see git history / the conversation this was built from) — the selectors below are
 * written to be as resilient as reasonably possible (role/text-based, not brittle CSS classes) but
 * they WILL need adjusting against the real site on the first live run. Every step captures a
 * screenshot to `debugDir` on failure so a broken selector is a one-look fix, not a guessing game.
 */

export type AdelSyncType = "CCMA" | "CCMI";

// The query-tool IDs the Spelc gave us for each campaign type — fixed URL fragments in ADEL's
// hash-routed single-page app.
const QUERY_TOOL_ID: Record<AdelSyncType, string> = {
  CCMI: "r310",
  CCMA: "r301",
};

export interface AdelScraperConfig {
  loginUrl: string;
  username: string;
  password: string;
  /** Filter value entered next to "nom du Spelc" — e.g. "azur". */
  spelcName: string;
  /** Directory to write a screenshot to if a step fails, for debugging. Optional. */
  debugDir?: string;
  /** Overall timeout for the whole flow, in ms. The export generation step is the slow part. */
  timeoutMs?: number;
  /** Explicit path to a Chromium executable, when the system-installed one shouldn't be
   * auto-resolved by Playwright (e.g. a pre-provisioned browser at a fixed path). Optional. */
  executablePath?: string;
}

export interface AdelExportResult {
  buffer: Buffer;
  suggestedFileName: string;
}

async function captureFailureScreenshot(page: Page, debugDir: string | undefined, step: string): Promise<void> {
  if (!debugDir) return;
  try {
    const path = join(debugDir, `adel-failure-${step}-${Date.now()}.png`);
    await page.screenshot({ path, fullPage: true });
  } catch {
    // best-effort only — don't let a screenshot failure hide the real error
  }
}

/** Finds the <option> whose visible text matches `labelPattern` inside `select` and selects it —
 * more forgiving than Playwright's exact-match selectOption({label}) for text we can't verify live. */
async function selectOptionByPattern(page: Page, select: ReturnType<Page["locator"]>, labelPattern: RegExp): Promise<void> {
  const options = await select.locator("option").all();
  for (const option of options) {
    const text = (await option.textContent()) ?? "";
    if (labelPattern.test(text)) {
      const value = await option.getAttribute("value");
      if (value !== null) {
        await select.selectOption(value);
        return;
      }
    }
  }
  throw new Error(`Aucune option ne correspond à ${labelPattern} dans la liste déroulante`);
}

export async function scrapeAdelExport(config: AdelScraperConfig, type: AdelSyncType): Promise<AdelExportResult> {
  const timeoutMs = config.timeoutMs ?? 180_000;
  const browser = await chromium.launch({ headless: true, executablePath: config.executablePath });
  let step = "démarrage";
  try {
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    page.setDefaultTimeout(timeoutMs);

    // --- 1. Login ---
    step = "connexion";
    await page.goto(config.loginUrl);
    // Not `input[type="text"], input[type="email"]`: a CSS attribute selector only matches an
    // explicit HTML attribute, and plenty of old-style login forms (this one included, per the
    // first real run) mark up their username field as plain `<input>` with no `type` attribute at
    // all — the browser treats that as text, but the attribute selector never sees it. Matching
    // "any visible input that isn't obviously something else" is more resilient to that.
    const usernameField = page
      .locator(
        'input:visible:not([type="password"]):not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="submit"]):not([type="button"])',
      )
      .first();
    await usernameField.fill(config.username);
    const passwordField = page.locator('input[type="password"]').first();
    await passwordField.fill(config.password);
    // Pressing Enter submits the nearest <form> regardless of how the login control is marked up
    // (plain <button>, <a>, or a JS-driven element with no standard type attribute) — a real login
    // button here turned out not to match `button[type="submit"], input[type="submit"]` at all, and
    // waiting the full step timeout on a selector that may not exist is exactly what to avoid.
    await passwordField.press("Enter");
    await page.waitForLoadState("networkidle");

    // If the password field is still visible, Enter didn't submit the form — fall back to an
    // explicit button click, bounded to a short timeout rather than the full step timeout.
    if (await passwordField.isVisible().catch(() => false)) {
      await page
        .locator("button, input[type='submit'], input[type='button'], a")
        .filter({ hasText: /connexion|connecter|valider|^ok$/i })
        .first()
        .click({ timeout: 10_000 });
      await page.waitForLoadState("networkidle");
    }

    // --- 2. Navigate to the query tool ---
    // Try a direct hash navigation first (fast path for a hash-routed SPA); if the expected field
    // isn't there afterwards, fall back to clicking through Gestion -> outils de recherche.
    step = "navigation vers l'outil de requêtage";
    const queryUrl = `${config.loginUrl.split("#")[0]}#gestionoutilrequetage/${QUERY_TOOL_ID[type]}`;
    await page.goto(queryUrl);
    await page.waitForLoadState("networkidle");

    const spelcField = page.getByLabel(/nom du spelc/i).or(page.getByPlaceholder(/nom du spelc/i));
    if (!(await spelcField.first().isVisible().catch(() => false))) {
      await page.getByText("Gestion", { exact: true }).first().click();
      await page.getByText(/outils de recherche/i).first().click();
      await page.getByRole("link", { name: new RegExp(QUERY_TOOL_ID[type], "i") }).first().click();
      await page.waitForLoadState("networkidle");
    }

    // --- 3. Filter by Spelc name ---
    step = "filtre nom du Spelc";
    await page.getByLabel(/nom du spelc/i).or(page.getByPlaceholder(/nom du spelc/i)).first().fill(config.spelcName);

    // --- 4. Export ---
    step = "clic sur export";
    await page.getByRole("button", { name: /export/i }).or(page.getByText(/^export$/i)).first().click();

    // --- 5. Choose "export excel suite à une recherche" in the popup ---
    step = "choix du type d'export dans la popup";
    const popupPromise = page.waitForEvent("popup", { timeout: 5_000 }).catch(() => null);
    const popup = (await popupPromise) ?? page;
    const exportSelect = popup.getByRole("combobox").first();
    await selectOptionByPattern(popup, exportSelect, /export excel.*recherche/i);

    // --- 6. Generate, then download ---
    step = "génération et téléchargement du fichier";
    const downloadPromise = popup.waitForEvent("download", { timeout: timeoutMs });
    await popup.getByRole("button", { name: /g[ée]n[ée]rer/i }).first().click();
    // Some export tools show a separate "enregistrer / télécharger" link once generation
    // finishes rather than starting the download directly — click it if it shows up while we
    // also keep waiting on the original download promise.
    popup
      .getByRole("link", { name: /enregistrer|t[ée]l[ée]charger/i })
      .first()
      .click({ timeout: timeoutMs })
      .catch(() => {});
    const download = await downloadPromise;

    const tmpDir = await mkdtemp(join(tmpdir(), "adel-export-"));
    const tmpPath = join(tmpDir, "export.xlsx");
    await download.saveAs(tmpPath);
    const buffer = await readFile(tmpPath);
    await rm(tmpDir, { recursive: true, force: true });

    const today = new Date().toISOString().slice(0, 10);
    return { buffer, suggestedFileName: `${today}_${type}_avancement.xlsx` };
  } catch (err) {
    const page = browser.contexts()[0]?.pages()[0];
    if (page) await captureFailureScreenshot(page, config.debugDir, step);
    throw new Error(`Étape ADEL "${step}" a échoué : ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await browser.close();
  }
}
