import { describe, expect, it } from "vitest";
import { deriveDepartementFromFileName } from "../src/routes/imports.js";

describe("deriveDepartementFromFileName", () => {
  it("recognizes a real CCMI file name for each département — confirmed by the union", () => {
    expect(deriveDepartementFromFileName("PE CE Alpes-Maritimes - avancements d'échelon 2025-2026.txt")).toBe("06");
    expect(deriveDepartementFromFileName("PE CE Var - avancements d'échelon 2025-2026.txt")).toBe("83");
  });

  it("is case-insensitive", () => {
    expect(deriveDepartementFromFileName("pe ce alpes-maritimes.txt")).toBe("06");
    expect(deriveDepartementFromFileName("PE CE VAR.PDF")).toBe("83");
  });

  it("returns null for a CCMA file name (no département split) — the expected, harmless default", () => {
    expect(deriveDepartementFromFileName("4531 CERTIFIE CN echelon 07.txt")).toBeNull();
    expect(deriveDepartementFromFileName("avancement_echelon_certifies.pdf")).toBeNull();
  });

  it("doesn't misfire on a name merely containing \"var\" as a substring, not as its own word", () => {
    expect(deriveDepartementFromFileName("variation_test.txt")).toBeNull();
    expect(deriveDepartementFromFileName("Edouard VARIN - fiche.txt")).toBeNull();
  });
});
