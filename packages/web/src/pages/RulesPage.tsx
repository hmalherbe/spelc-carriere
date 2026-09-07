/**
 * Reference page: the practical career-advancement rules a gestionnaire actually needs day to
 * day. For the deeper reverse-engineering notes (rectorat PDF format, date/gain formulas, adhérent
 * matching) see docs/REVERSE_ENGINEERING.md in the repo. For the échelon-by-échelon indice tables,
 * see the "Grilles indiciaires" tab.
 */
export function RulesPage() {
  return (
    <div className="import-page">
      <p className="hint">
        Règles de changement d'échelon pour les cas particuliers (bonification d'ancienneté, hors-classe, classe
        exceptionnelle) — la progression normale d'échelon (durée + indice par grade) est dans l'onglet « Grilles
        indiciaires ».
      </p>

      <section className="card">
        <h2>Bonification d'ancienneté « BA » (échelons 6 et 8 uniquement)</h2>
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
        <p>
          Être dans la fenêtre ne garantit pas la bonification : le rectorat ne publie pas son seuil de sélection parmi
          les enseignants éligibles. L'estimation est déduite empiriquement chaque campagne, par (grade, échelon départ),
          à partir des enseignants réellement promus cette année-là — une cascade à 4 niveaux :
        </p>
        <ol className="rule-list">
          <li>barème minimum parmi les promus ;</li>
          <li>parmi ceux à barème égal, ancienneté de grade minimum ;</li>
          <li>parmi ceux-là, ancienneté d'échelon minimum ;</li>
          <li>parmi ceux-là, âge minimum.</li>
        </ol>
        <p className="rule-highlight">
          C'est une <strong>inférence statistique</strong> sur les résultats de l'année, pas la règle officielle du
          rectorat — d'où la décision de la rendre verrouillable/corrigeable par un admin (page « Seuils BA ») plutôt
          que de la présenter comme une certitude.
        </p>
      </section>

      <section className="card">
        <h2>Hors-classe</h2>
        <p>
          Échelon 9 de la classe normale avec au moins <strong>2 ans d'ancienneté</strong> dans cet échelon (arrêtée au
          31 août de l'année du tableau d'avancement) — ou automatiquement éligible à partir de l'échelon 10 ou 11.
        </p>
      </section>

      <section className="card">
        <h2>Classe exceptionnelle</h2>
        <p>
          Règle en vigueur depuis la réforme 2024 (le système à deux « viviers » a disparu) : purement statutaire,{" "}
          <strong>aucune ancienneté supplémentaire requise</strong>. Il suffit d'avoir atteint l'échelon 5 de la
          hors-classe (échelon 4 pour les agrégés — numéroté « A1 » dans leur grille) au 31 août de l'année de
          promotion.
        </p>
      </section>
    </div>
  );
}
