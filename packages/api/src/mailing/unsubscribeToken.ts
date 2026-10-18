import { createHmac, timingSafeEqual, scryptSync } from "node:crypto";
import { normalizeName } from "@spelc/import";

/**
 * Désabonnement des notifications par mail (non-adhérents uniquement, voir buildUnsubscribeLink
 * dans template.ts) : le lien en pied de mail doit identifier le destinataire SANS session (il est
 * cliqué depuis une boîte mail, jamais connecté à l'appli) et doit rester valable indéfiniment,
 * y compris après que le MailingLog d'origine ait été remplacé par celui d'une campagne ultérieure.
 * Plutôt qu'un identifiant opaque stocké en base (une ligne à créer, chercher, jamais expirer), le
 * token est un simple payload signé (HMAC) : il porte lui-même l'identité du destinataire
 * (email + nom/prénom normalisés), vérifiable sans aucune lecture en base. Ça garde aussi /preview
 * et /pdf/text (routes/mailing.ts) purement en lecture : le même token est recalculable à l'identique
 * à chaque appel, sans jamais rien écrire.
 *
 * Keyed off JWT_SECRET (comme crypto.ts) avec un "info" de dérivation différent, pour ne jamais
 * réutiliser la même clé dérivée que le chiffrement des secrets ADEL/Brevo.
 */

export interface UnsubscribePayload {
  email: string | null;
  nom: string;
  prenom: string;
}

function deriveKey(): Buffer {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("JWT_SECRET must be set (see packages/api/.env)");
  return scryptSync(secret, "spelc-mailing-unsubscribe", 32);
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

/** Construit le token à mettre dans l'URL — déterministe : la même personne obtient toujours
 * exactement le même lien, campagne après campagne. */
export function buildUnsubscribeToken(payload: UnsubscribePayload): string {
  // Le nom/prénom sont normalisés AVANT signature : le token reste valide même si l'orthographe
  // brute varie légèrement d'une fiche à l'autre (accents, casse) — seule l'identité normalisée
  // (celle utilisée pour le matching, voir eligibleRecipients() dans routes/mailing.ts) compte.
  const canonical = { email: payload.email?.trim().toLowerCase() || null, nom: normalizeName(payload.nom), prenom: normalizeName(payload.prenom) };
  const body = base64url(JSON.stringify(canonical));
  const signature = base64url(createHmac("sha256", deriveKey()).update(body).digest());
  return `${body}.${signature}`;
}

/** Vérifie la signature et renvoie le payload (déjà normalisé) — null si le token est invalide ou
 * altéré (jamais d'exception : un lien d'e-mail peut avoir été tronqué/mal copié par un client mail,
 * ce n'est pas une erreur serveur). */
export function verifyUnsubscribeToken(token: string): UnsubscribePayload | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, signature] = parts;

  let expected: Buffer;
  let actual: Buffer;
  try {
    expected = createHmac("sha256", deriveKey()).update(body).digest();
    actual = Buffer.from(signature, "base64url");
  } catch {
    return null;
  }
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf-8"));
    if (typeof parsed.nom !== "string" || typeof parsed.prenom !== "string") return null;
    return { email: typeof parsed.email === "string" ? parsed.email : null, nom: parsed.nom, prenom: parsed.prenom };
  } catch {
    return null;
  }
}
