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
| **`packages/web`** — frontend React | ✅ Connexion, tableau de bord enseignants (échelon, gain, estimation BA), file de révision des rapprochements, écran de verrouillage des seuils BA, écran d'import (PDF rectorat multi-fichiers + mise à jour ADEL), écran de mailing (sélection, aperçu, envoi via Brevo), onglet "Règles de gestion" (règles métier extraites du rétro-engineering). Vérifié en navigateur (captures d'écran). |
| **`packages/import`** — parseur PDF rectorat + import adhérents (CSV + XLSX) + matching | ✅ Codé, testé (31 tests, dont 1 intégration sur un vrai PDF). Validé de bout en bout sur les 5 vrais fichiers rectorat fournis (458/458 fiches importées, seule 1 anomalie signalée — un glitch d'encodage réel du PDF source) via `POST /imports/rectorat` et `POST /imports/adherents`, base de données réelle. |
| **`packages/scraper`** — automatisation ADEL (Playwright) | ⚠️ Codé (login, navigation, export, téléchargement) d'après une description écrite du parcours, **pas encore validé contre le vrai site** — les sélecteurs devront probablement être ajustés au premier essai réel (voir "Synchronisation ADEL" ci-dessous). |
| Mailing (Brevo) | ✅ Envoi d'un e-mail de notification personnalisé (grade, échelon, date, gain) à chaque adhérent dont le rapprochement est confirmé, via l'API transactionnelle Brevo. Historique conservé (`MailingLog`), un adhérent n'est jamais notifié deux fois par accident. Testé (10 tests : template HTML échappé contre l'injection, client Brevo mocké) ; le déclenchement réel nécessite `BREVO_API_KEY`/`BREVO_SENDER_EMAIL` (non fournis dans cet environnement — le comportement "non configuré" a été vérifié en conditions réelles, erreur claire côté UI). |

## Structure

```
packages/
  domain/   → moteur de calcul pur (aucune dépendance DB/HTTP), réutilisable par l'API et par des scripts de test/simulation
  import/   → parseur PDF rectorat (pdf-parse), parseur CSV/XLSX adhérents, matching fuzzy nom/prénom
  scraper/  → automatisation Playwright de l'export ADEL (login + navigation + téléchargement, headless)
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
npm test               # tests de tous les packages (domain, import, api)
```

### Mailing (Brevo)

L'envoi d'e-mails passe par l'API transactionnelle de [Brevo](https://www.brevo.com/) (ex-Sendinblue).
Sans clé configurée, l'écran "Mailing" reste utilisable (aperçu, sélection) mais l'envoi renvoie une
erreur explicite plutôt que d'échouer silencieusement. Pour activer l'envoi réel, ajoutez à
`packages/api/.env` :

```bash
BREVO_API_KEY="xkeysib-..."          # clé API Brevo (Paramètres du compte -> Clés API)
BREVO_SENDER_EMAIL="contact@spelc-nice.fr"   # expéditeur, doit être un e-mail validé dans Brevo
BREVO_SENDER_NAME="Spelc Nice"       # optionnel, "Spelc" par défaut
```

### Synchronisation ADEL (`packages/scraper`)

Remplace l'export manuel + upload CSV par une automatisation Playwright : connexion à ADEL,
navigation vers l'outil de requêtage CCMA/CCMI, filtre par nom de Spelc, export Excel, puis import
direct dans l'application (même moteur de rapprochement que l'ancien import CSV).

Prérequis unique (une seule fois par machine) :
```bash
npx playwright install chromium
```

Puis dans `packages/api/.env` :
```bash
ADEL_URL="https://annuaire-spelc.bayard-service.com/annuaire_spelc/Admin.jsp#listepersonnes"
ADEL_USERNAME="..."
ADEL_PASSWORD="..."
ADEL_SPELC_NAME="azur"   # optionnel, "azur" par défaut — filtre "nom du Spelc"
```

⚠️ **Ce scraper n'a pas encore été testé contre le vrai site ADEL** — il a été écrit à partir d'une
description du parcours, pas d'une inspection directe des pages. Les sélecteurs (`packages/scraper/src/adelScraper.ts`)
devront probablement être ajustés au premier essai réel ; chaque étape capture une copie d'écran
dans `debugDir` (si fourni) en cas d'échec, pour identifier rapidement quel sélecteur corriger.

## Prochaines étapes proposées

1. Valider et ajuster `packages/scraper` contre le vrai site ADEL (premier essai réel à faire).
2. Export/rapport imprimable pour la CCMA (remplace la mise en forme Excel du classeur source).
3. Historique/traçabilité plus fine des imports (diff entre deux exports rectorat successifs).
