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
| **`packages/api`** — modèle de données + backend Express/Prisma/JWT | ✅ Schéma validé, migrations appliquées, seed de démo, routes auth/campagnes/teachers/matches/ba-seuils testées de bout en bout (curl + RBAC). |
| **`packages/web`** — frontend React | ✅ Connexion, tableau de bord enseignants (échelon, gain, estimation BA), file de révision des rapprochements, écran de verrouillage des seuils BA. Vérifié en navigateur (captures d'écran). |
| **`packages/import`** — parseur PDF rectorat + import adhérents + matching | ✅ Codé, testé (27 tests, dont 1 intégration sur un vrai PDF). Validé de bout en bout sur les 5 vrais fichiers rectorat fournis (458/458 fiches importées, seule 1 anomalie signalée — un glitch d'encodage réel du PDF source) via `POST /imports/rectorat` et `POST /imports/adherents`, base de données réelle. |

## Structure

```
packages/
  domain/   → moteur de calcul pur (aucune dépendance DB/HTTP), réutilisable par l'API et par des scripts de test/simulation
  import/   → parseur PDF rectorat (pdf-parse), parseur CSV adhérents, matching fuzzy nom/prénom
  api/      → backend Express + Prisma/PostgreSQL + auth JWT (rôles ADMIN/GESTIONNAIRE/LECTURE)
  web/      → frontend React + Vite (tableau de bord, file de révision, seuils BA)
docs/
  REVERSE_ENGINEERING.md → règles métier extraites du fichier Excel/PDF source
```

## Démarrer

Prérequis : PostgreSQL local (ou accessible), Node 20+.

```bash
npm install

# Base de données
sudo -u postgres psql -c "CREATE ROLE spelc WITH LOGIN PASSWORD 'spelc_dev_password' CREATEDB;"
sudo -u postgres psql -c "CREATE DATABASE spelc OWNER spelc;"
cd packages/api
npx prisma migrate dev
npm run seed          # charge la grille indiciaire + des données de démo

# Lancer l'API (port 4000) et le frontend (port 5173, proxy /api -> :4000)
npm run dev            # dans packages/api
cd ../web && npm run dev
```

Comptes de démo (créés par le seed) : `admin@spelc.example` / `admin1234` (ADMIN),
`gestionnaire@spelc.example` / `gest1234` (GESTIONNAIRE).

```bash
npm test               # tests du moteur de calcul (packages/domain)
```

## Prochaines étapes proposées

1. Écran d'import (upload PDF/CSV) côté frontend — les endpoints `POST /imports/rectorat` et
   `POST /imports/adherents` sont fonctionnels mais seulement appelables via API pour l'instant.
2. Export mailing (remplace le publipostage Excel).
