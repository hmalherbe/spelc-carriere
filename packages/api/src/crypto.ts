import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

/**
 * Encrypts secrets (currently just the ADEL scraper password) before they're stored in the
 * database, so a DB dump alone doesn't leak a third-party login credential in plaintext.
 *
 * Keyed off JWT_SECRET rather than a separate env var — one less secret to provision — which also
 * means rotating JWT_SECRET makes any previously-encrypted value undecryptable. Accepted tradeoff:
 * that's a rare op, and the fix is just re-entering the password in the Paramètres screen.
 */
function deriveKey(): Buffer {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET must be set (see packages/api/.env)");
  return scryptSync(secret, "spelc-adel-config", 32);
}

/** Returns "iv.tag.ciphertext", each base64 — self-contained, so no separate storage needed for the IV/tag. */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf-8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext].map((b) => b.toString("base64")).join(".");
}

export function decryptSecret(encoded: string): string {
  const [ivB64, tagB64, ciphertextB64] = encoded.split(".");
  const decipher = createDecipheriv("aes-256-gcm", deriveKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextB64, "base64")), decipher.final()]).toString("utf-8");
}
