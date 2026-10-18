import { describe, expect, it, beforeAll } from "vitest";
import { buildUnsubscribeToken, verifyUnsubscribeToken } from "../src/mailing/unsubscribeToken.js";

describe("unsubscribeToken", () => {
  beforeAll(() => {
    process.env.JWT_SECRET = "test-secret-only-for-this-suite";
  });

  it("round-trips email and normalized nom/prénom", () => {
    const token = buildUnsubscribeToken({ email: "Jean.Dupont@Ac-Nice.Fr", nom: "Dupont", prenom: "Jean" });
    const payload = verifyUnsubscribeToken(token);
    expect(payload).toEqual({ email: "jean.dupont@ac-nice.fr", nom: "DUPONT", prenom: "JEAN" });
  });

  it("is deterministic — the same identity always yields the same token", () => {
    const a = buildUnsubscribeToken({ email: "a@b.fr", nom: "Martin", prenom: "Élise" });
    const b = buildUnsubscribeToken({ email: "a@b.fr", nom: "Martin", prenom: "Élise" });
    expect(a).toBe(b);
  });

  it("normalizes accents/case before signing, so slightly different spellings produce the same token", () => {
    const a = buildUnsubscribeToken({ email: null, nom: "Chové", prenom: "anne-sophie" });
    const b = buildUnsubscribeToken({ email: null, nom: "CHOVE", prenom: "Anne-Sophie" });
    expect(a).toBe(b);
  });

  it("rejects a tampered payload (signature no longer matches)", () => {
    const token = buildUnsubscribeToken({ email: "a@b.fr", nom: "Martin", prenom: "Elise" });
    const [body, signature] = token.split(".");
    const tamperedBody = Buffer.from(JSON.stringify({ email: "attacker@evil.fr", nom: "MARTIN", prenom: "ELISE" })).toString("base64url");
    expect(verifyUnsubscribeToken(`${tamperedBody}.${signature}`)).toBeNull();
  });

  it("rejects garbage input without throwing", () => {
    expect(verifyUnsubscribeToken("not-a-token")).toBeNull();
    expect(verifyUnsubscribeToken("")).toBeNull();
    expect(verifyUnsubscribeToken("a.b.c")).toBeNull();
  });
});
