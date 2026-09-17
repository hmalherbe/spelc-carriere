/**
 * Turns Mistral's generated SQL into something safe to run against the real database. Mistral's
 * output is untrusted the same way any user input is — the model can hallucinate, and nothing
 * stops a crafted question from trying to get it to emit something destructive — so every query is
 * re-validated here regardless of what the system prompt asked for. Defense in depth on top of this
 * module: the caller also runs the query inside a READ ONLY transaction with a short statement
 * timeout (see routes/aiAssistant.ts).
 */

export class UnsafeSqlError extends Error {}

// Every table the AI assistant is allowed to touch — deliberately excludes User (passwordHash),
// AdelConfig/BrevoConfig/MistralConfig (encrypted secrets) and MailingBranding (raw logo bytes),
// none of which are useful to answer a career-management question anyway.
export const ALLOWED_TABLES = [
  "Campagne",
  "RectoratImport",
  "TeacherSnapshot",
  "Teacher",
  "Adherent",
  "AcademicEmail",
  "MatchCandidate",
  "ComputedPromotionState",
  "MailingLog",
  "AdelSyncLog",
  "Elu",
  "SocialLink",
  "Grille",
  "EchelonRow",
  "ValeurDuPoint",
  "GradeMapping",
] as const;

// Statement types/functions that must never appear in a query the assistant executes, even wrapped
// inside an otherwise-innocuous SELECT (e.g. "SELECT pg_sleep(10)" or a CTE with a data-modifying
// statement). Checked as whole words so it doesn't false-positive on identifiers like "asset" or
// "reset".
const FORBIDDEN_KEYWORDS = [
  "insert",
  "update",
  "delete",
  "drop",
  "alter",
  "truncate",
  "grant",
  "revoke",
  "create",
  "exec",
  "execute",
  "call",
  "copy",
  "vacuum",
  "merge",
  "replace",
  "attach",
  "detach",
  "into",
  "set",
  "do",
  "listen",
  "notify",
  "reset",
  "pg_sleep",
  "pg_read_file",
  "pg_read_binary_file",
  "pg_write_file",
  "lo_import",
  "lo_export",
  "dblink",
  "pg_terminate_backend",
  "pg_cancel_backend",
];

/**
 * Validates `rawSql` (Mistral's raw response text) and returns an executable, row-capped SELECT.
 * Throws UnsafeSqlError with a French, user-facing reason on anything that doesn't look like a
 * single, plain, read-only SELECT against an allowed table.
 */
export function assertSafeSelect(rawSql: string, allowedTables: readonly string[] = ALLOWED_TABLES): string {
  let sql = rawSql.trim();
  // Mistral sometimes wraps its answer in a markdown code fence despite being told not to.
  sql = sql
    .replace(/^```(?:sql)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  if (!sql) throw new UnsafeSqlError("Le modèle n'a renvoyé aucune requête SQL.");
  if (!/^select\b/i.test(sql)) {
    throw new UnsafeSqlError("Seules les requêtes SELECT sont autorisées (pas de CTE / WITH).");
  }
  if (sql.includes("--") || sql.includes("/*")) {
    throw new UnsafeSqlError("Les commentaires SQL ne sont pas autorisés dans la requête générée.");
  }

  // At most one trailing semicolon is tolerated — anything else means multiple statements.
  const body = sql.replace(/;\s*$/, "");
  if (body.includes(";")) {
    throw new UnsafeSqlError("Une seule instruction SQL est autorisée.");
  }

  const lower = body.toLowerCase();
  for (const keyword of FORBIDDEN_KEYWORDS) {
    if (new RegExp(`\\b${keyword}\\b`).test(lower)) {
      throw new UnsafeSqlError(`Mot-clé non autorisé détecté dans la requête générée : "${keyword}".`);
    }
  }

  const allowedLower = new Set(allowedTables.map((t) => t.toLowerCase()));
  const tableMatches = [...body.matchAll(/\b(?:from|join)\s+"?([a-zA-Z_][a-zA-Z0-9_]*)"?/gi)];
  if (tableMatches.length === 0) {
    throw new UnsafeSqlError("Aucune table reconnue dans la requête générée.");
  }
  for (const match of tableMatches) {
    if (!allowedLower.has(match[1].toLowerCase())) {
      throw new UnsafeSqlError(`Table non autorisée pour l'assistant IA : "${match[1]}".`);
    }
  }

  // Wrap rather than try to detect/replace an existing LIMIT — always caps the row count
  // regardless of what the model produced, and works for a plain SELECT or a UNION alike.
  return `SELECT * FROM (${body}) AS ai_assistant_query LIMIT 200`;
}
