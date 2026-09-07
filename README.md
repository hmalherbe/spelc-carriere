# Spelc — Outil de gestion de carrière

Reconstruction, en ReactJS + Node.js + PostgreSQL, du système de gestion de carrière du Spelc
(suivi des changements d'échelon, croisement adhérents/rectorat, calcul du gain salarial),
aujourd'hui porté par un fichier Excel central (formules + requêtes Power Query) alimenté par les
exports PDF du rectorat.

## Décisions produit actées

- **Matching adhérent ↔ enseignant** : un lien confirmé est permanent (ID stable en base) ; seuls
  les nouveaux cas ambigus remontent dans une file de révision manuelle à chaque import.
- **Seuil de promotion "au choix" (BA, échelons 6/8)** : estimé automatiquement à partir des
  résultats confirmés de la campagne, mais verrouillable/corrigeable par un admin.
- **Périmètre V1** : académie de Nice (06/83) uniquement, multi-utilisateurs avec rôles
  (ADMIN / GESTIONNAIRE / LECTURE).

## État d'avancement

| Bloc | État |
|---|---|
| **`packages/domain`** — moteur de calcul (grille indiciaire, dates de promotion, gain brut/net, seuil BA, barèmes HC/EXC, reclassements) | ✅ Codé, testé (25 tests), typé strict. Validé contre une vraie valeur observée dans le classeur (148 € de gain net, échelon 5→6 grille AGR). |
| **`packages/api/prisma/schema.prisma`** — modèle de données complet | ✅ Écrit, validé, formaté, client généré. |
| Parseur des exports PDF rectorat | ⏳ Format entièrement documenté (voir `docs/REVERSE_ENGINEERING.md`) mais pas encore codé. |
| Moteur de matching adhérents ↔ rectorat | ⏳ Règles identifiées (fuzzy match nom/prénom + dictionnaire d'accents) mais pas encore codé. |
| API (routes, auth) | ⏳ Pas commencé. |
| Frontend React | ⏳ Pas commencé. |

## Pourquoi commencer par le moteur de calcul et le modèle de données

C'est la partie la plus risquée à mal reproduire (arrondis, calendrier bancaire 360 jours, cascade
de barèmes) et celle sur laquelle tout le reste (API, UI) repose. Elle est maintenant fiable et
testée ; le reste est un travail d'intégration plus mécanique.

## Structure

```
packages/
  domain/   → moteur de calcul pur (aucune dépendance DB/HTTP), réutilisable par l'API et par des scripts de test/simulation
  api/      → backend (Prisma + PostgreSQL), à construire
  web/      → frontend React, à construire
docs/
  REVERSE_ENGINEERING.md → règles métier extraites du fichier Excel/PDF source
```

## Démarrer

```bash
npm install
npm test              # fait tourner les tests du moteur de calcul
```

## Prochaines étapes proposées

1. Parseur des PDF rectorat (texte déjà extractible, pas besoin d'OCR) → `TeacherSnapshot`.
2. Import adhérents (ADEL) + moteur de matching avec file de révision.
3. Routes API (imports, revue des matches, verrouillage des seuils BA, export mailing).
4. UI React : tableau de bord, file de révision, écran de verrouillage des seuils, export.
5. Auth (rôles ADMIN/GESTIONNAIRE/LECTURE).
