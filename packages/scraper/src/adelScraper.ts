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
}

export interface AdelExportResult {
  buffer: Buffer;
  suggestedFileName: string;
}

async function screenshotOnFailure(page: Page, debugDir: string | undefined, step: string, err: unknown): Promise<never> {
  if (debugDir) {
    try {
      const path = join(debugDir, `adel-failure-${step}-${Date.now()}.png`);
      await page.screenshot({ path, fullPage: true });
    } catch {
      // best-effort only — don't let a screenshot failure hide the real error
    }
  }
  throw new Error(`Étape ADEL "${step}" a échoué : ${err instanceof Error ? err.message : String(err)}`);
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
  const browser = await chromium.launch({ headless: true });
  let step = "démarrage";
  try {
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    page.setDefaultTimeout(timeoutMs);

    // --- 1. Login ---
    step = "connexion";
    await page.goto(config.loginUrl);
    await page.locator('input[type="text"], input[type="email"]').first().fill(config.username);
    await page.locator('input[type="password"]').first().fill(config.password);
    await page.locator('button[type="submit"], input[type="submit"]').first().click();
    await page.waitForLoadState("networkidle");

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
    if (page) return screenshotOnFailure(page, config.debugDir, step, err);
    throw new Error(`Étape ADEL "${step}" a échoué : ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await browser.close();
  }
}
