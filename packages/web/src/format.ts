/**
 * Every source (rectorat exports, ADEL) gives prénoms in ALL CAPS — this renders them "Marie",
 * "Jean-Baptiste", "Mamy Mirinah" for display, capitalizing the first letter after the start of the
 * string and after each space/hyphen/apostrophe, lowercasing everything else. Never applied to
 * NOM (kept as the source gives it — all caps is the conventional French "NOM Prénom" styling).
 */
export function formatPrenom(prenom: string): string {
  return prenom.toLowerCase().replace(/(^|[ '-])([a-zà-ÿ])/g, (_, sep, letter) => sep + letter.toUpperCase());
}
