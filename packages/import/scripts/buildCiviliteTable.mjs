#!/usr/bin/env node
/**
 * Regenerates src/civiliteTable.json from INSEE's public "Fichier des prénoms" (data.gouv.fr,
 * dataset "fichier-des-prenoms-depuis-1900", national-level CSV — e.g. nat2022.csv, one row per
 * sexe/prénom/année with a birth count). Not run automatically (no network access needed at build
 * or runtime — this script is a one-off maintenance tool for whenever a newer INSEE export is
 * worth picking up): download the national CSV by hand and run
 *
 *   node scripts/buildCiviliteTable.mjs path/to/natXXXX.csv src/civiliteTable.json
 *
 * Aggregates total births per prénom across all sexes/years, keeping only prénoms where one sex
 * accounts for at least CONFIDENCE_THRESHOLD of all births — exactly the same "never guess wrong
 * on a real letter" rule the previous hand-curated list followed, just computed from real national
 * data instead of a few hundred manually typed entries. 0.90 was picked by checking every name the
 * old hand-curated list already trusted: the least confident one it listed (Gontran) is 91.6% one
 * sex in the real data, while the most confident name it deliberately left out as epicene (Claude)
 * peaks at 87.9% — 0.90 sits cleanly between the two, so every prénom the union was already
 * comfortable guessing stays resolved, and every one it deliberately left ambiguous stays excluded
 * (confirmed with zero sex-flip regressions against the old list when this script was written).
 */
import { readFileSync, writeFileSync } from "node:fs";

const [, , csvPath, outPath] = process.argv;
if (!csvPath || !outPath) {
  console.error("Usage: node buildCiviliteTable.mjs <nat*.csv path> <output json path>");
  process.exit(1);
}

// Must match normalizeName() in src/matching.ts exactly, so lookup keys generated here line up
// with what civiliteFromPrenom.ts computes at runtime.
function normalizeName(s) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
}

const CONFIDENCE_THRESHOLD = 0.9;
const MIN_TOTAL = 20; // drop pure noise below INSEE's own already-aggregated "_PRENOMS_RARES" cutoff

const text = readFileSync(csvPath, "utf-8");
const lines = text.split("\n");

const counts = new Map(); // normalized prénom -> { M, F }

for (let i = 1; i < lines.length; i++) {
  const line = lines[i].trim();
  if (!line) continue;
  const [sexe, preusuel, , nombreStr] = line.split(";");
  if (preusuel === "_PRENOMS_RARES") continue;
  const nombre = parseInt(nombreStr, 10);
  if (!Number.isFinite(nombre)) continue;

  const key = normalizeName(preusuel);
  if (!key) continue;

  let entry = counts.get(key);
  if (!entry) {
    entry = { M: 0, F: 0 };
    counts.set(key, entry);
  }
  if (sexe === "1") entry.M += nombre;
  else if (sexe === "2") entry.F += nombre;
}

const table = {};
let kept = 0;
let ambiguous = 0;
let tooRare = 0;

for (const [key, { M, F }] of counts) {
  const total = M + F;
  if (total < MIN_TOTAL) {
    tooRare++;
    continue;
  }
  const ratio = Math.max(M, F) / total;
  if (ratio < CONFIDENCE_THRESHOLD) {
    ambiguous++;
    continue;
  }
  table[key] = M > F ? "M" : "F";
  kept++;
}

writeFileSync(outPath, JSON.stringify(table));

console.log("Distinct normalized prénoms seen:", counts.size);
console.log("Kept (confident one sex):", kept);
console.log("Excluded as ambiguous (<90% one sex):", ambiguous);
console.log("Excluded as too rare (<20 total births):", tooRare);
console.log("Output file size (bytes):", JSON.stringify(table).length);
