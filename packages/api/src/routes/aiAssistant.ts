import { Router } from "express";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAuth } from "../auth/middleware.js";
import { asyncHandler } from "../asyncHandler.js";
import { decryptSecret } from "../crypto.js";
import { callMistralChat, MistralConfigError, type MistralChatMessage } from "../aiAssistant/mistralClient.js";
import { assertSafeSelect, UnsafeSqlError } from "../aiAssistant/sqlSafety.js";
import { SCHEMA_DESCRIPTION } from "../aiAssistant/schemaDescription.js";

export const aiAssistantRouter = Router();
aiAssistantRouter.use(requireAuth);

const SINGLETON_ID = "singleton";

// A fixed, curated starting point — not generated on the fly by Mistral — so the tab is useful
// even before an API key is configured, and doesn't cost a call just to render some examples.
const SUGGESTED_QUESTIONS = [
  "Combien d'enseignants sont promouvables à la bonification d'ancienneté (BA) cette campagne ?",
  "Quels enseignants ont été promus (Pro BA.) à l'échelon 7 cette campagne ?",
  "Combien y a-t-il d'adhérents par grade ?",
  "Quels enseignants sont en attente de validation dans la file de révision (rapprochements) ?",
  "Quel est le gain de salaire net moyen des enseignants promus cette campagne ?",
  "Combien de mails de notification ont échoué lors du dernier envoi ?",
  "Quels enseignants proches de la hors-classe (échelon 9 classe normale) n'ont pas encore d'adhérent associé ?",
  "Combien d'adhérents ont une adresse mail personnelle renseignée ?",
  "Quelles sont les 10 dernières synchronisations ADEL et leur statut ?",
  "Combien de campagnes CCMA et combien de campagnes CCMI existent, par année scolaire ?",
];

aiAssistantRouter.get("/suggestions", (_req, res) => {
  res.json({ questions: SUGGESTED_QUESTIONS });
});

/** Same DB-row-wins-over-env pattern as routes/adel.ts / routes/mailing.ts — no MISTRAL_API_KEY
 * env fallback though: this integration only ever existed via the Paramètres screen. */
async function loadMistralConfig(): Promise<{ apiKey: string; model: string }> {
  const dbConfig = await prisma.mistralConfig.findUnique({ where: { id: SINGLETON_ID } });
  if (!dbConfig?.apiKeyEncrypted) {
    throw new MistralConfigError("Assistant IA non configuré : renseignez la clé API Mistral dans l'onglet Paramètres.");
  }
  return { apiKey: decryptSecret(dbConfig.apiKeyEncrypted), model: dbConfig.model };
}

/** JSON can't serialize bigint (e.g. a raw COUNT(*)) or, safely, arbitrary Buffer values — convert
 * to plain JSON-friendly types row by row rather than trusting every column ever queried. */
function serializeRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      if (typeof value === "bigint") out[key] = value.toString();
      else if (value instanceof Uint8Array) out[key] = `(${value.length} octets)`;
      else out[key] = value;
    }
    return out;
  });
}

async function runReadOnlySelect(sql: string): Promise<Record<string, unknown>[]> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '8000'`);
    await tx.$executeRawUnsafe(`SET TRANSACTION READ ONLY`);
    return tx.$queryRawUnsafe<Record<string, unknown>[]>(sql);
  });
}

const askSchema = z.object({ question: z.string().min(3).max(1000) });

// A generated query can be rejected by assertSafeSelect (disallowed construct) or fail at execution
// (genuine SQL syntax/semantics error — e.g. a LIMIT inside an unparenthesized UNION branch, or
// ORDER BY inside a DISTINCT aggregate referencing a different column — both real cases seen in
// practice). Rather than only ever patching the system prompt one Postgres gotcha at a time as new
// ones surface, feed the actual error back to the model and let it correct its own query — same
// idea as a human iterating in a SQL console. Capped at a few rounds: a model that can't fix its own
// mistake after being told exactly what Postgres said about it isn't going to on a 5th try either,
// and every round costs a real API call.
const MAX_SQL_ATTEMPTS = 3;

aiAssistantRouter.post(
  "/ask",
  asyncHandler(async (req, res) => {
    const parsed = askSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Corps de requête invalide", details: parsed.error.flatten() });
    }

    let mistral: { apiKey: string; model: string };
    try {
      mistral = await loadMistralConfig();
    } catch (err) {
      if (err instanceof MistralConfigError) return res.status(400).json({ error: err.message });
      throw err;
    }

    const messages: MistralChatMessage[] = [
      { role: "system", content: SCHEMA_DESCRIPTION },
      { role: "user", content: parsed.data.question },
    ];

    let safeSql: string | undefined;
    let rows: Record<string, unknown>[] | undefined;
    let lastErrorMessage = "Échec inconnu";

    for (let attempt = 1; attempt <= MAX_SQL_ATTEMPTS; attempt++) {
      let rawSql: string;
      try {
        rawSql = await callMistralChat(mistral.apiKey, mistral.model, messages);
      } catch (err) {
        return res.status(502).json({ error: err instanceof Error ? err.message : String(err) });
      }
      messages.push({ role: "assistant", content: rawSql });

      try {
        safeSql = assertSafeSelect(rawSql);
      } catch (err) {
        if (!(err instanceof UnsafeSqlError)) throw err;
        lastErrorMessage = err.message;
        if (attempt === MAX_SQL_ATTEMPTS) {
          return res.status(422).json({ error: `La requête générée n'a pas pu être exécutée en toute sécurité : ${err.message}` });
        }
        messages.push({
          role: "user",
          content: `Cette requête n'est pas autorisée : ${err.message}\nCorrige-la et réponds à nouveau UNIQUEMENT avec la requête SQL corrigée, en respectant les mêmes règles qu'au départ.`,
        });
        continue;
      }

      try {
        rows = serializeRows(await runReadOnlySelect(safeSql));
        break;
      } catch (err) {
        lastErrorMessage = err instanceof Error ? err.message : String(err);
        if (attempt === MAX_SQL_ATTEMPTS) {
          return res.status(422).json({
            error: `La requête générée a échoué à l'exécution : ${lastErrorMessage}`,
            sql: safeSql,
          });
        }
        messages.push({
          role: "user",
          content: `Cette requête a échoué à l'exécution avec l'erreur Postgres suivante : ${lastErrorMessage}\nCorrige-la et réponds à nouveau UNIQUEMENT avec la requête SQL corrigée, en respectant les mêmes règles qu'au départ.`,
        });
      }
    }

    if (!safeSql || !rows) {
      // Unreachable in practice (every loop exit above either returns or sets both) — satisfies
      // TypeScript's control-flow analysis without a non-null assertion.
      return res.status(422).json({ error: lastErrorMessage });
    }

    let summary: string;
    try {
      summary = await callMistralChat(mistral.apiKey, mistral.model, [
        {
          role: "system",
          content:
            "Tu es un assistant qui résume en français, en quelques phrases concises et factuelles, le résultat " +
            "d'une requête SQL pour un gestionnaire du Spelc Côte d'Azur (syndicat enseignant). Ne donne aucun " +
            "conseil juridique. S'il n'y a aucune ligne de résultat, dis-le simplement.",
        },
        {
          role: "user",
          content: `Question posée : ${parsed.data.question}\n\nRésultat (JSON, jusqu'à 200 lignes) :\n${JSON.stringify(rows.slice(0, 200))}`,
        },
      ]);
    } catch (err) {
      // The query itself succeeded — still worth returning the raw rows even if the summarization
      // call fails (rate limit, transient network issue), rather than discarding a working result.
      summary = `(Résumé indisponible : ${err instanceof Error ? err.message : String(err)})`;
    }

    res.json({ sql: safeSql, rowCount: rows.length, rows, summary });
  }),
);
