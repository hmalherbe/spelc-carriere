/**
 * Estimates a person's civilité (Mme/M.) from their prénom alone, for the one case where we have
 * no declared value to go on: a non-adhérent teacher, who never gave the union a Civ. field (that
 * only exists on the adhérent side, from the ADEL export — see adherentCsvParser.ts). Per product
 * decision, this is always an estimation, never presented as a declared fact: a caller must keep
 * it visually distinct from Adherent.civilite (see routes/mailing.ts and MailingPage.tsx).
 *
 * The table below is a hand-curated list of common French prénoms strongly associated with one
 * civilité, not a full name-frequency dataset (INSEE's public "Fichier des prénoms" covers every
 * prénom ever declared, including one-off/rare spellings, and would need per-entry frequency
 * weighting to be usable as a lookup) — deliberately biased towards prénoms common in the
 * generations currently teaching (b. ~1950-2000) since that's who this app is ever asked about.
 * Epicene prénoms (Dominique, Camille, Claude, Maxime is NOT epicene so it's kept, etc.) are
 * deliberately left out of both lists rather than guessed either way: a missing/ambiguous entry
 * must resolve to `null` ("non déterminé"), never a wrong civilité on a real letter.
 */

import { normalizeName } from "./matching.js";

const FEMININS = [
  "Marie", "Jeanne", "Denise", "Yvonne", "Madeleine", "Simone", "Suzanne", "Renée", "Odette",
  "Paulette", "Georgette", "Ginette", "Monique", "Françoise", "Jacqueline", "Nicole", "Michèle",
  "Christiane", "Danielle", "Colette", "Annie", "Josette", "Josiane", "Liliane", "Yvette",
  "Huguette", "Andrée", "Gilberte", "Raymonde", "Bernadette", "Claudine", "Martine", "Chantal",
  "Brigitte", "Catherine", "Sylvie", "Véronique", "Isabelle", "Nathalie", "Christine", "Corinne",
  "Sandrine", "Valérie", "Pascale", "Patricia", "Carole", "Karine", "Laurence", "Marina",
  "Stéphanie", "Céline", "Delphine", "Virginie", "Aurélie", "Émilie", "Julie", "Marion",
  "Elodie", "Laetitia", "Amandine", "Charlotte", "Léa", "Manon", "Chloé", "Sarah", "Clara",
  "Emma", "Lucie", "Justine", "Océane", "Anaïs", "Alicia", "Mélanie", "Audrey", "Caroline",
  "Cécile", "Claire", "Agnès", "Anne", "Anne-Marie", "Marie-Claude", "Marie-Christine",
  "Marie-France", "Marie-Hélène", "Marie-Laure", "Marie-Line", "Marie-Noëlle", "Marie-Odile",
  "Marie-Pierre", "Marie-Thérèse", "Hélène", "Sophie", "Sabine", "Sandra", "Sonia", "Séverine",
  "Vanessa", "Vanina", "Angélique", "Bénédicte", "Béatrice", "Blandine", "Carine", "Cathy",
  "Cindy", "Coralie", "Elisabeth", "Élise", "Estelle", "Eugénie", "Evelyne", "Fabienne", "Fanny",
  "Florence", "Gaëlle", "Geneviève", "Ghislaine", "Gisèle", "Ingrid", "Irène", "Jocelyne",
  "Joëlle", "Judith", "Julia", "Juliette", "Karen", "Laure", "Léna", "Lise", "Louise", "Lucile",
  "Lydia", "Lydie", "Magali", "Maryse", "Mathilde", "Maud", "Mélissa", "Mireille", "Muriel",
  "Myriam", "Nadège", "Nadia", "Nadine", "Nelly", "Nina", "Noémie", "Odile", "Olivia", "Ophélie",
  "Pascaline", "Peggy", "Perrine", "Priscilla", "Rachel", "Rébecca", "Régine", "Roseline",
  "Sabrina", "Salomé", "Samantha", "Stella", "Suzon", "Tatiana", "Thérèse", "Valentine",
  "Yolande", "Zoé", "Adèle", "Alexandra", "Alix", "Amélie", "Ariane", "Armelle", "Aude",
  "Barbara", "Camélia", "Diane", "Doriane", "Eléonore", "Emeline", "Eva", "Fabiola", "Flora",
  "Florine", "Frédérique", "Ines", "Iris", "Jade", "Jasmine", "Léonie", "Léontine", "Lisa",
  "Loriane", "Margaux", "Margot", "Marlène", "Marguerite", "Mila", "Morgane",
  "Nathacha", "Nine", "Noëlle", "Pauline", "Prisca", "Quitterie", "Rose", "Roxane", "Solange",
  "Solène", "Tiphaine", "Yasmine", "Yseult",
];

const MASCULINS = [
  "Jean", "Pierre", "Michel", "André", "René", "Louis", "Marcel", "Henri", "Robert", "Roger",
  "Georges", "Maurice", "Jacques", "Bernard", "Guy", "Alain", "Daniel", "Gérard", "Christian",
  "Yves", "Philippe", "Patrick", "Didier", "Jean-Pierre", "Jean-Claude", "Jean-Paul",
  "Jean-Marc", "Jean-Luc", "Jean-François", "Jean-Michel", "Jean-Louis", "Jean-Yves",
  "Jean-Marie", "Francis", "Serge", "Bruno", "Thierry", "Pascal", "Éric", "Olivier", "Frédéric",
  "Stéphane", "Laurent", "Christophe", "Vincent", "Nicolas", "David", "Sébastien", "Julien",
  "Arnaud", "Cédric", "Fabrice", "Franck", "Grégory", "Guillaume", "Ludovic", "Mathieu",
  "Maxime", "Rémi", "Romain", "Samuel", "Thibault", "Yannick", "Xavier", "Antoine", "Benjamin",
  "Damien", "Denis", "Dimitri", "Emmanuel", "Fabien", "Florent", "Gaël", "Gilles", "Grégoire",
  "Hervé", "Hugo", "Jérémy", "Jérôme", "Joël", "Jonathan", "Kevin", "Loïc", "Lucas", "Marc",
  "Mathis", "Mickaël", "Nathan", "Norbert", "Quentin", "Raphaël", "Rémy", "Rodolphe", "Simon",
  "Théo", "Thomas", "Tom", "Tony", "Valentin", "William", "Yann", "Yohan", "Adrien", "Alexandre",
  "Alexis", "Anthony", "Aurélien", "Baptiste", "Benoît", "Bertrand", "Cyril", "Enzo", "Étienne",
  "Evan", "Ferdinand", "Fernand", "Gabriel", "Gaston", "Gérald", "Gilbert", "Hubert", "Ivan",
  "Jason", "Jules", "Julian", "Léo", "Léon", "Léonard", "Lionel", "Loris", "Lucien", "Malo",
  "Marius", "Martin", "Mattéo", "Max", "Michaël", "Milo", "Morgan", "Nathanaël", "Noah",
  "Octave", "Pacôme", "Paul", "Raymond", "Régis", "Robin", "Roland", "Sacha", "Sylvain", "Teddy",
  "Tristan", "Ulysse", "Valère", "Victor", "Vivien", "Wilfried", "Zacharie", "Alban", "Albert",
  "Arthur", "Aymeric", "Basile", "Boris", "Cyrille", "Édouard", "Elliot", "Émile", "Erwan",
  "Fabian", "Félix", "Florian", "Geoffrey", "Germain", "Gontran", "Hector", "Hippolyte",
  "Honoré", "Igor", "Jacky", "Kylian", "Léandre", "Marin", "Mathurin", "Maël", "Noé",
  "Numa", "Odilon", "Oscar", "Placide", "Prosper", "Rayan", "Rodrigue", "Ronan", "Sylvestre",
  "Timothée", "Wilfrid", "Yanis", "Yvan", "Ezio",
];

function buildTable(names: string[], sex: "M" | "F"): Map<string, "M" | "F"> {
  const table = new Map<string, "M" | "F">();
  for (const name of names) table.set(normalizeName(name), sex);
  return table;
}

const FEMININS_TABLE = buildTable(FEMININS, "F");
const MASCULINS_TABLE = buildTable(MASCULINS, "M");

// Any prénom hand-listed on both sides is a curation mistake, not a real epicene case (those are
// deliberately absent from both lists) — drop it from the lookup entirely rather than let whichever
// list happens to be applied last win silently.
for (const key of FEMININS_TABLE.keys()) {
  if (MASCULINS_TABLE.has(key)) {
    FEMININS_TABLE.delete(key);
    MASCULINS_TABLE.delete(key);
  }
}

function lookupSex(prenom: string): "M" | "F" | null {
  const key = normalizeName(prenom);
  return FEMININS_TABLE.get(key) ?? MASCULINS_TABLE.get(key) ?? null;
}

/**
 * Returns "Mme" / "M" (matching the token shape extractCivilite() already produces for adhérents —
 * see adherentCsvParser.ts and civilitePrefix() in mailing/template.ts) or null when the prénom
 * isn't a confident match. Falls back to just the first given name of a compound prénom ("Jean" out
 * of "Jean-Pierre", "Marie" out of "Marie Claire") when the full compound isn't itself listed.
 */
export function civiliteFromPrenom(prenom: string): "Mme" | "M" | null {
  const trimmed = prenom.trim();
  if (!trimmed) return null;

  const direct = lookupSex(trimmed);
  if (direct) return direct === "F" ? "Mme" : "M";

  const firstPart = trimmed.split(/[\s-]+/)[0];
  if (firstPart && firstPart !== trimmed) {
    const bySplit = lookupSex(firstPart);
    if (bySplit) return bySplit === "F" ? "Mme" : "M";
  }

  return null;
}
