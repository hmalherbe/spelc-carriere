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
| Parseur des exports PDF rectorat | ⏳ Format entièrement documenté (voir `docs/REVERSE_ENGINEERING.md`) mais pas encore codé — les données de démo sont saisies à la main dans `prisma/seed.ts`. |
| Moteur de matching adhérents ↔ rectorat | ⏳ Règles identifiées (fuzzy match nom/prénom + dictionnaire d'accents) mais pas encore codé — la file de révision fonctionne, il manque juste le calcul automatique des candidats. |

## Structure

```
packages/
  domain/   → moteur de calcul pur (aucune dépendance DB/HTTP), réutilisable par l'API et par des scripts de test/simulation
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

1. Parseur des PDF rectorat (texte déjà extractible, pas besoin d'OCR) → alimente `TeacherSnapshot`
   à la place de la saisie manuelle actuelle du seed.
2. Import adhérents (ADEL) + calcul automatique des candidats de rapprochement (fuzzy match +
   score de confiance) qui alimentent la file de révision déjà fonctionnelle.
3. Export mailing (remplace le publipostage Excel).
4. Écran d'import (upload PDF/CSV) côté frontend.
