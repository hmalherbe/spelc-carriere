import { describe, expect, it } from "vitest";
import { assertSafeSelect, UnsafeSqlError } from "../src/aiAssistant/sqlSafety.js";

describe("assertSafeSelect", () => {
  it("wraps a plain SELECT against an allowed table with a row cap", () => {
    const sql = assertSafeSelect('SELECT "nom", "prenom" FROM "Teacher"');
    expect(sql).toBe('SELECT * FROM (SELECT "nom", "prenom" FROM "Teacher") AS ai_assistant_query LIMIT 200');
  });

  it("strips a markdown code fence the model added despite instructions", () => {
    const sql = assertSafeSelect('```sql\nSELECT * FROM "Teacher"\n```');
    expect(sql).toContain('SELECT * FROM "Teacher"');
  });

  it("tolerates a single trailing semicolon", () => {
    const sql = assertSafeSelect('SELECT * FROM "Teacher";');
    expect(sql).toBe('SELECT * FROM (SELECT * FROM "Teacher") AS ai_assistant_query LIMIT 200');
  });

  it("rejects anything that isn't a SELECT", () => {
    expect(() => assertSafeSelect('DELETE FROM "Teacher"')).toThrow(UnsafeSqlError);
    expect(() => assertSafeSelect('WITH x AS (SELECT 1) SELECT * FROM x')).toThrow(UnsafeSqlError);
  });

  it("rejects a table outside the allowlist", () => {
    expect(() => assertSafeSelect('SELECT * FROM "User"')).toThrow(UnsafeSqlError);
  });

  it("rejects forbidden keywords hidden inside an otherwise-plain SELECT", () => {
    expect(() => assertSafeSelect("SELECT pg_sleep(10)")).toThrow(UnsafeSqlError);
    expect(() => assertSafeSelect('SELECT * INTO "Evil" FROM "Teacher"')).toThrow(UnsafeSqlError);
  });

  it("rejects multiple statements", () => {
    expect(() => assertSafeSelect('SELECT * FROM "Teacher"; DROP TABLE "Teacher";')).toThrow(UnsafeSqlError);
  });

  it("rejects SQL comments", () => {
    expect(() => assertSafeSelect('SELECT * FROM "Teacher" -- comment')).toThrow(UnsafeSqlError);
    expect(() => assertSafeSelect('SELECT * FROM "Teacher" /* comment */')).toThrow(UnsafeSqlError);
  });

  it("does not false-positive on identifiers that merely contain a forbidden keyword", () => {
    const sql = assertSafeSelect('SELECT "resetAt" FROM "AdelSyncLog"');
    expect(sql).toContain('"resetAt"');
  });

  it("rejects an empty response", () => {
    expect(() => assertSafeSelect("   ")).toThrow(UnsafeSqlError);
  });
});
