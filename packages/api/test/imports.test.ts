import { describe, expect, it } from "vitest";
import { deriveDepartementFromFileName, checkDegreMismatch } from "../src/routes/imports.js";

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

// Real case that forced this guard: campagne CCMI 2025-2026 ended up with second-degré teachers
// (CERTIFIE et al.) imported by mistake alongside the legitimate "Prof. Ecoles" ones. Takes
// Campagne.commission directly (not the whole campagne/type) — same guard reused for both the
// échelon import (commission = type for CCMA/CCMI) and the HC/EXC import (commission, once set).
describe("checkDegreMismatch", () => {
  it("rejects a premier degré grade (CCMI) imported with commission CCMA", () => {
    expect(checkDegreMismatch("CCMA", "Prof. Ecoles")).toMatch(/premier degré.*CCMI/);
    expect(checkDegreMismatch("CCMA", "Prof. Ecoles HC")).toMatch(/premier degré/);
  });

  it("rejects a second degré grade (CCMA) imported with commission CCMI — real case, campagne CCMI 2025-2026", () => {
    expect(checkDegreMismatch("CCMI", "CERTIFIE")).toMatch(/second degré.*CCMA/);
    expect(checkDegreMismatch("CCMI", "AGREGE")).toMatch(/second degré/);
    expect(checkDegreMismatch("CCMI", "PLP")).toMatch(/second degré/);
  });

  it("allows a matching degré/commission combination", () => {
    expect(checkDegreMismatch("CCMA", "CERTIFIE")).toBeNull();
    expect(checkDegreMismatch("CCMA", "AGREGE HC")).toBeNull();
    expect(checkDegreMismatch("CCMI", "Prof. Ecoles")).toBeNull();
    expect(checkDegreMismatch("CCMI", "Prof. Ecoles EXC")).toBeNull();
  });

  it("the premier-degré MD 1/MD 2 (maître auxiliaire) grades count as CCMI, not CCMA", () => {
    expect(checkDegreMismatch("CCMA", "MD 1")).toMatch(/premier degré/);
    expect(checkDegreMismatch("CCMI", "MD 2")).toBeNull();
  });

  it("never rejects when commission is null (not yet scoped, or a legacy campagne) — nothing to check against", () => {
    expect(checkDegreMismatch(null, "Prof. Ecoles")).toBeNull();
    expect(checkDegreMismatch(null, "CERTIFIE")).toBeNull();
  });

  it("never rejects an unrecognized grade — that's RECTORAT_GRADE_CODE_MAP's own error to raise, not this guard's", () => {
    expect(checkDegreMismatch("CCMA", "Un grade inconnu")).toBeNull();
    expect(checkDegreMismatch("CCMI", "Un grade inconnu")).toBeNull();
  });
});
