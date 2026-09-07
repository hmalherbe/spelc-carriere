/**
 * Reference page: the business rules extracted during reverse-engineering of the source Excel
 * workbook (formulas + Power Query M code) and the rectorat PDF exports. See
 * docs/REVERSE_ENGINEERING.md in the repo for the full write-up this page summarizes — kept here
 * too so a gestionnaire can check a rule without opening the codebase.
 */
export function RulesPage() {
  return (
    <div className="import-page">
      <p className="hint">
        Règles métier extraites du classeur Excel central (formules + requêtes Power Query) et des exports PDF du rectorat
        fournis en modèle. Toutes les valeurs citées ci-dessous viennent directement de ces sources, pas d'une hypothèse.
      </p>

      <section className="card">
        <h2>1. Format des exports rectorat (PDF "AVANCEMENT D'ECHELON")</h2>
        <p>
          Un fichier par grade (4531 = Certifié CN, 4532 = Certifié HC, 4534 = Certifié Classe Exceptionnelle, 4511 = Agrégé
          HC, 4512 = Agrégé CN, et équivalents EPS/PLP), regroupé par échelon actuel.
        </p>
        <p>
          Par enseignant : nom/prénom, date de naissance, établissement (code RNE, type, nom/CP/ville), discipline, date
          d'accès à l'échelon actuel, type et date de la prochaine promotion — <strong>AN</strong> = ancienneté,{" "}
          <strong>CL</strong> = choix, <strong>BA</strong> = bonification d'ancienneté (« grand choix »), <strong>RE</strong> =
          refusé/reporté (avec un délai au format <code>XXaYYmZZj</code>) — et un bloc « Barème » : <code>EVAECH</code> (avis
          0-4, seulement pour les grades avec rendez-vous de carrière), <code>Z1AGRA</code>, <code>Z1ANEC</code>,{" "}
          <code>Z2AGEA</code>.
        </p>
        <p className="rule-highlight">
          <strong>Piège identifié :</strong> <code>Z2AGEA</code> n'est pas une date de naissance. C'est l'âge de l'enseignant,
          encodé en <code>AAMMJJ</code>, à la date de référence de la campagne. Vérifié sur un cas réel : né le 30/04/1995,{" "}
          <code>Z2AGEA=290402</code> = 29 ans, 4 mois, 2 jours au 01/09/2024.
        </p>
        <p className="hint">
          Pied de chaque bloc échelon : « NOMBRE DE PROMOUVABLES » / « PROMUS » (colonnes BA et AN) — le quota réel appliqué
          par le rectorat, jamais publié en détail ailleurs.
        </p>
      </section>

      <section className="card">
        <h2>2. Format de durée <code>XXaYYmZZj</code></h2>
        <p>
          Utilisé à la fois dans les PDF rectorat (durée restante avant promotion) et dans les colonnes « ancienneté à
          déduire / à reporter » du classeur central : <code>années</code> (2 chiffres) + <code>a</code> +{" "}
          <code>mois</code> (2 chiffres) + <code>m</code> + <code>jours</code> (2 chiffres) + <code>j</code>.
        </p>
        <p>Converti en jours sur un calendrier <strong>bancaire</strong> — mois de 30 jours, année de 360 jours :</p>
        <pre className="rule-formula">jours_bancaires = jours + 30 × mois + 360 × années</pre>
      </section>

      <section className="card">
        <h2>3. Date de la prochaine promotion</h2>
        <pre className="rule-formula">{`joursADeduire   = ancienneteADeduire  en jours bancaires (360/30)
joursAReporter  = ancienneteAReporter en jours bancaires
dureeEchelon    = VLOOKUP(échelon actuel, grille du grade, colonne DUREE)   // en années
nbJours         = dureeEchelon × 360 + joursADeduire − joursAReporter      // 0 si dureeEchelon = "MAX"
(années, mois, jours) = conversion inverse jours bancaires → Y/M/D
dateProchainePromotion = dateDernierChangementEchelon + (années, mois, jours), sur calendrier RÉEL`}</pre>
        <p className="hint">
          Implémenté dans <code>packages/domain/src/calculations/promotion.ts</code>.
        </p>
      </section>

      <section className="card">
        <h2>4. Gain salarial</h2>
        <pre className="rule-formula">{`traitementBrutMensuel(indice) = ROUND(indice × Valeur_du_point / 12, 0)
Valeur_du_point = 59.07336 €   (valeur annuelle d'un point d'indice)

Gain_salaire_brut = traitementBrutMensuel(futurIndice) − traitementBrutMensuel(indiceActuel)
                    // deux arrondis INDÉPENDANTS, pas un arrondi de la différence

Gain_salaire_net  = ROUND((futurIndice − indiceActuel) × Valeur_du_point × 0.77 / 12, 0)
                    // 0.77 = ratio net/brut approximatif, pas un calcul de fiche de paie exact`}</pre>
        <p className="rule-highlight">
          Validé contre une vraie valeur du classeur source : échelon 5→6, grille AGR (indice 584→623), donne bien{" "}
          <strong>148 € de gain net</strong>.
        </p>
      </section>

      <section className="card">
        <h2>5. Grille indiciaire</h2>
        <p>
          Grilles distinctes : <code>AGR</code>, <code>AECE</code>, <code>BI_ADM</code>, <code>PROFS</code> (regroupe
          certifiés/PLP/PEPS/professeurs des écoles classe normale), <code>INSTIT</code>, <code>PEGC</code>, et leurs
          variantes hors-classe (<code>HC_*</code>) et classe exceptionnelle (<code>EXC_*</code>), plus{" "}
          <code>MA_1</code>/<code>MA_2</code> (maîtres auxiliaires). Chaque grille est une liste (échelon, échelon suivant,
          indice, durée en années ou <code>MAX</code>).
        </p>
        <p className="hint">
          Extraites exhaustivement dans <code>packages/domain/src/data/grilles.ts</code>. La correspondance grade rectorat →
          grille (+ degré 1er/2nd, accès HC/Classe Exceptionnelle) est dans <code>packages/domain/src/data/refs.ts</code>{" "}
          (<code>GRADE_MAPPINGS</code>).
        </p>
      </section>

      <section className="card">
        <h2>6. Éligibilité Hors-Classe / Classe Exceptionnelle (règles PPCR)</h2>
        <p>
          Contrairement au seuil « BA » (voir §7, qui reste une inférence statistique), l'éligibilité à la hors-classe et à
          la classe exceptionnelle suit des règles <strong>publiées et déterministes</strong> — implémentées dans{" "}
          <code>packages/domain/src/calculations/eligibility.ts</code>, calculées automatiquement pour chaque enseignant
          et affichées dans la colonne « Éligibilité HC / Exc. » du tableau de bord.
        </p>
        <p>
          <strong>Hors-classe</strong> : échelon 9 de la classe normale avec au moins <strong>2 ans d'ancienneté</strong>{" "}
          dans cet échelon (arrêtée au 31 août de l'année du tableau d'avancement) — ou automatiquement éligible à partir
          de l'échelon 10 ou 11.
        </p>
        <p>
          <strong>Classe exceptionnelle</strong> (règle en vigueur depuis la réforme 2024 — le système à deux « viviers »
          a disparu) : purement statutaire, <strong>aucune ancienneté supplémentaire requise</strong>. Il suffit d'avoir
          atteint l'échelon 5 de la hors-classe (échelon 4 pour les agrégés — numéroté « A1 » dans leur grille) au 31 août
          de l'année de promotion.
        </p>
        <p className="rule-highlight">
          <strong>Historique :</strong> le classeur source encode encore le système à points{" "}
          (<code>POINTS_BONIFICATION_EXC_AVIS_RECTEUR</code>, <code>POINTS_ANCIENNETE_EXC_*</code> dans <code>refs.ts</code>)
          qui servait de sélection avant la réforme 2024. Ce code est conservé (utile pour le reclassement — quel échelon
          on obtient une fois promu) mais <strong>ne détermine plus l'éligibilité</strong>, qui suit désormais les règles
          statutaires ci-dessus.
        </p>
      </section>

      <section className="card">
        <h2>7. Bonification d'ancienneté « BA » (échelons 6 et 8 uniquement)</h2>
        <p>
          Permet d'accélérer d'un an le passage à l'échelon supérieur pour environ <strong>30 % des enseignants</strong>,
          suite aux 1er et 2e rendez-vous de carrière — mais seulement pour ceux qui sont dans la bonne fenêtre
          d'ancienneté au moment de la campagne :
        </p>
        <ul className="rule-list">
          <li>
            <strong>Échelon 6 → 7</strong> : être dans la <strong>2ᵉ année</strong> de l'échelon 6 (ancienneté entre 1 et 2
            ans). Passage en 2 ans au lieu de 3 si accordée.
          </li>
          <li>
            <strong>Échelon 8 → 9</strong> : avoir entre <strong>18 et 30 mois</strong> d'ancienneté dans l'échelon 8.
            Passage en 2,5 ans au lieu de 3,5 si accordée.
          </li>
        </ul>
        <p className="hint">
          Cette fenêtre d'éligibilité (<code>isEligibleBonificationAnciennete</code> dans{" "}
          <code>packages/domain/src/calculations/eligibility.ts</code>) est vérifiée avant même de calculer une
          estimation — un enseignant hors fenêtre n'affiche aucune estimation BA, quel que soit son barème.
        </p>
        <p>
          Être dans la fenêtre ne garantit pas la bonification : le rectorat ne publie pas son seuil de sélection parmi
          les enseignants éligibles. Le classeur source le <strong>déduit empiriquement</strong> chaque campagne, par
          (grade, échelon départ), à partir des enseignants réellement promus cette année-là — une cascade à 4 niveaux :
        </p>
        <ol className="rule-list">
          <li>barème minimum parmi les promus ;</li>
          <li>parmi ceux à barème égal, ancienneté de grade minimum ;</li>
          <li>parmi ceux-là, ancienneté d'échelon minimum ;</li>
          <li>parmi ceux-là, âge minimum.</li>
        </ol>
        <p>
          Ce quadruplet (le « dernier promu ») sert ensuite de seuil pour estimer si un autre enseignant du même groupe
          serait promu.
        </p>
        <p className="rule-highlight">
          C'est une <strong>inférence statistique</strong> sur les résultats de l'année, pas la règle officielle du
          rectorat — d'où la décision produit de le rendre verrouillable/corrigeable par un admin (page « Seuils BA »)
          plutôt que de le présenter comme une certitude.
        </p>
        <p className="hint">
          Implémenté dans <code>packages/domain/src/calculations/baThreshold.ts</code>.
        </p>
      </section>

      <section className="card">
        <h2>8. Rapprochement adhérents ↔ rectorat</h2>
        <p>
          Le classeur source fait un rapprochement flou (<code>Table.FuzzyNestedJoin</code>, ignore la casse et les
          espaces) sur nom+prénom, complété par un dictionnaire codé en dur d'environ 45 prénoms avec/sans accents
          (Stephanie → Stéphanie, etc.) pour absorber les incohérences de saisie entre les deux sources.
        </p>
        <p className="rule-highlight">
          Fragile par construction — d'où la décision produit de <strong>figer les liens une fois confirmés</strong> (ID
          stable) plutôt que de refaire ce rapprochement flou à chaque import. Cette version reconstruite utilise une
          similarité de Levenshtein (au lieu de l'algorithme propriétaire de Power Query) avec le même principe.
        </p>
      </section>

      <section className="card">
        <h2>Requêtes Power Query identifiées (référence historique)</h2>
        <p className="hint">
          Pour mémoire, les requêtes M du classeur source dont la logique a été portée dans ce projet : import par grade
          (<code>AGREGE_CL_NORMALE</code>, <code>CERTIFIES_HORS_CLASSE</code>, ...), rapprochement (« Adhérents Spelc
          éligibles CCM », « Compare ADEL et fichiers rectorats »), calcul d'état (<code>ETATS_CCM</code>,{" "}
          <code>ETATS_CCM_CALCULS</code>, <code>ETATS_CCM_CALCULS_COMPLETS</code>, « Changements échelon Tous »), cascade de
          seuil BA (« Promus BA », « Min Barèmes Promus BA », « Min ancienneté grade/échelon Promus BA », « Derniers promus
          BA HM », « Nombre de promus BA »), et une dizaine de requêtes « Erreurs dans ... » (contrôles de cohérence).
        </p>
      </section>
    </div>
  );
}
