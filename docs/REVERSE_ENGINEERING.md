# Règles métier extraites du système Excel/PDF existant

Notes de rétro-ingénierie, à garder comme référence pendant la reconstruction. Toutes les valeurs
citées viennent directement du classeur central (`.xlsm`) ou des exports PDF du rectorat fournis
comme modèles.

## 1. Format des exports rectorat (PDF "AVANCEMENT D'ECHELON")

Un fichier par grade (4531=Certifié CN, 4532=Certifié HC, 4534=Certifié Classe Except.,
4511=Agrégé HC, 4512=Agrégé CN, et équivalents EPS/PLP). Regroupement par échelon actuel.

Par enseignant : nom/prénom, date de naissance, code RNE + type d'établissement + nom/CP/ville,
discipline (code + libellé), date d'accès à l'échelon actuel, type et date de la prochaine
promotion (**AN**=ancienneté, **CL**=choix, **BA**=bonification d'ancienneté/grand choix,
**RE**=refusé/reporté — avec le délai au format `XXaYYmZZj`), et un bloc "Barème" :
`EVAECH` (avis 0-4, seulement pour les grades avec rendez-vous de carrière), `Z1AGRA`,
`Z1ANEC`, `Z2AGEA`.

**`Z2AGEA` n'est pas la date de naissance** : c'est l'âge encodé en `AAMMJJ` à la date de
référence de la campagne (vérifié : né le 30/04/1995, `Z2AGEA=290402` = 29 ans 4 mois 2 jours au
01/09/2024).

Pied de chaque bloc échelon : `NOMBRE DE PROMOUVABLES` / `PROMUS` (colonnes BA et AN) — le quota
réel appliqué par le rectorat, jamais publié en détail.

## 2. Format `XXaYYmZZj`

Utilisé à la fois dans les PDF rectorat (durée restante) et dans les colonnes "Ancienneté à
déduire/à reporter" du classeur central. `annees` (2 chiffres) + littéral `a` + `mois` (2 chiffres)
+ littéral `m` + `jours` (2 chiffres) + littéral `j`. Converti en jours sur un calendrier bancaire
(mois de 30 jours, année de 360 jours) : `jours + 30*mois + 360*annees`.

## 3. Calcul de la date de prochaine promotion

```
joursADeduire   = ancienneteADeduire  en jours bancaires (360/30)
joursAReporter  = ancienneteAReporter en jours bancaires
dureeEchelon    = VLOOKUP(échelon actuel, grille du grade, colonne DUREE)   // en années
nbJours         = dureeEchelon*360 + joursADeduire - joursAReporter        // 0 si dureeEchelon = "MAX"
(années, mois, jours) = conversion inverse jours bancaires → Y/M/D
dateProchainePromotion = dateDernierChangementEchelon + (années, mois, jours) sur CALENDRIER RÉEL
```

Implémenté dans `packages/domain/src/calculations/promotion.ts`.

## 4. Calcul du gain salarial

```
traitementBrutMensuel(indice) = ROUND(indice * Valeur_du_point / 12, 0)
Valeur_du_point = 59.07336 €  (valeur annuelle d'un point d'indice)

Gain_salaire_brut = traitementBrutMensuel(futurIndice) - traitementBrutMensuel(indiceActuel)
                    // deux arrondis indépendants, PAS un arrondi de la différence

Gain_salaire_net  = ROUND((futurIndice - indiceActuel) * Valeur_du_point * 0.77 / 12, 0)
                    // 0.77 = ratio net/brut approximatif (pas un calcul de fiche de paie exact)
```

Validé contre une vraie valeur du classeur : échelon 5→6 grille AGR (indice 584→623) donne
bien 148 € de gain net.

## 5. Grille indiciaire

Grilles distinctes : `AGR`, `AECE`, `BI_ADM`, `PROFS` (regroupe certifiés/PLP/PEPS/professeurs des
écoles classe normale), `INSTIT`, `PEGC`, et leurs variantes hors-classe (`HC_*`) et classe
exceptionnelle (`EXC_*`), plus `MA_1`/`MA_2` (maîtres auxiliaires). Chaque grille = liste
(échelon, échelon suivant, indice, durée en années ou `MAX`). Extraites exhaustivement dans
`packages/domain/src/data/grilles.ts`.

La correspondance grade rectorat → grille (+ degré 1er/2nd, accès HC/Classe Except.) est dans
`packages/domain/src/data/refs.ts` (`GRADE_MAPPINGS`).

## 6. Accès Hors Classe / Classe Exceptionnelle — système de points explicite

Contrairement au "BA" (voir §7), l'accès HC et Classe Exceptionnelle suit un barème de points
publié et reproductible :

```
points = bonification(avis du recteur, degré/corps) + points_ancienneté(échelon*10 + ancienneté_dans_échelon)
```

Tables de points et de reclassement (échelon+ancienneté avant → échelon après, avec ou sans
conservation de l'ancienneté) extraites dans `refs.ts`.

## 7. Seuil de sélection "BA" (bonification d'ancienneté, échelons 6 et 8 uniquement)

Le rectorat ne publie pas son seuil de sélection pour la promotion "au choix" à ces deux échelons.
Le classeur le **déduit empiriquement** chaque campagne, par (grade, échelon départ), à partir des
enseignants réellement promus cette année :

1. barème minimum parmi les promus
2. parmi ceux à barème égal, ancienneté de grade minimum
3. parmi ceux-là, ancienneté d'échelon minimum
4. parmi ceux-là, âge minimum

Ce quadruplet (le "dernier promu") sert ensuite de seuil pour estimer si un autre enseignant du
même groupe serait promu. **C'est une inférence statistique sur les résultats de l'année, pas la
règle officielle du rectorat** — d'où la décision produit de le rendre verrouillable/corrigeable
par un admin plutôt que de le présenter comme une certitude.

Implémenté dans `packages/domain/src/calculations/baThreshold.ts`.

## 8. Rapprochement adhérents ↔ rectorat

Rapprochement flou (`Table.FuzzyNestedJoin`, ignore la casse et les espaces) sur nom+prénom,
complété par un dictionnaire codé en dur de ~45 prénoms avec/sans accents (Stephanie→Stéphanie,
etc.) pour absorber les incohérences de saisie entre les deux sources. Fragile par construction —
d'où la décision produit de figer les liens une fois confirmés (ID stable) plutôt que de refaire
ce rapprochement flou à chaque import.

## Requêtes Power Query identifiées (référence)

Import par grade (`AGREGE_CL_NORMALE`, `CERTIFIES_HORS_CLASSE`, ...), rapprochement
(`Adhérents Spelc éligibles CCM`, `Compare ADEL et fichiers rectorats`), calcul d'état
(`ETATS_CCM`, `ETATS_CCM_CALCULS`, `ETATS_CCM_CALCULS_COMPLETS`, `Changements échelon Tous`),
cascade de seuil BA (`Promus BA`, `Min Barèmes Promus BA`, `Min ancienneté grade/échelon Promus
BA`, `Derniers promus BA HM`, `Nombre de promus BA`), et une dizaine de requêtes `Erreurs dans
...` (contrôles de cohérence).
