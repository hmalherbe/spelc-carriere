// Shared with the mailing templates (packages/api) — see packages/domain/src/calculations/textFormat.ts.
export { formatPrenom, formatEchelonLabel } from "@spelc/domain";

/** "2024-2025" -> période du 01/09/2024 au 31/08/2025 — la convention scolaire standard, qu'il n'y
 * a donc pas de raison de faire ressaisir à la main à chaque campagne. null si l'année scolaire ne
 * suit pas le format attendu (deux années à 4 chiffres séparées d'un tiret) : l'admin garde alors
 * la main pour la corriger lui-même plutôt que de se voir imposer une date fausse. Partagé entre
 * ImportPage (création d'une seule campagne) et le sélecteur d'année scolaire en en-tête (création
 * groupée des 6 campagnes d'une année) — même convention, une seule fois. */
export function derivePeriodeFromAnneeScolaire(anneeScolaire: string): { periodeDebut: string; periodeFin: string } | null {
  const m = /^(\d{4})-(\d{4})$/.exec(anneeScolaire.trim());
  if (!m) return null;
  const [, anneeDebut, anneeFin] = m;
  return { periodeDebut: `${anneeDebut}-09-01`, periodeFin: `${anneeFin}-08-31` };
}
