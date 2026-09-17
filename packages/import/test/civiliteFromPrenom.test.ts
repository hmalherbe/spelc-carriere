import { describe, expect, it } from "vitest";
import { civiliteFromPrenom } from "../src/civiliteFromPrenom.js";

describe("civiliteFromPrenom", () => {
  it("recognizes a common feminine prénom", () => {
    expect(civiliteFromPrenom("Isabelle")).toBe("Mme");
    expect(civiliteFromPrenom("Nathalie")).toBe("Mme");
  });

  it("recognizes a common masculine prénom", () => {
    expect(civiliteFromPrenom("Philippe")).toBe("M");
    expect(civiliteFromPrenom("Nicolas")).toBe("M");
  });

  it("is case/accent/whitespace insensitive, like normalizeName", () => {
    expect(civiliteFromPrenom("  stephanie ")).toBe("Mme");
    expect(civiliteFromPrenom("PHILIPPE")).toBe("M");
  });

  it("falls back to the first given name of a compound prénom not itself listed", () => {
    expect(civiliteFromPrenom("Philippe Antoine")).toBe("M");
    expect(civiliteFromPrenom("Isabelle-Marie")).toBe("Mme");
  });

  it("returns null for an epicene prénom rather than guessing", () => {
    expect(civiliteFromPrenom("Dominique")).toBeNull();
    expect(civiliteFromPrenom("Camille")).toBeNull();
    expect(civiliteFromPrenom("Claude")).toBeNull();
  });

  it("returns null for a prénom not in the table", () => {
    expect(civiliteFromPrenom("Zzyxqrst")).toBeNull();
  });

  it("returns null for an empty prénom", () => {
    expect(civiliteFromPrenom("")).toBeNull();
    expect(civiliteFromPrenom("   ")).toBeNull();
  });
});
