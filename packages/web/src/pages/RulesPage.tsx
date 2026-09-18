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
        Règles de changement d'échelon pour les cas particuliers (bonification d'ancienneté) — la progression normale
        d'échelon (durée + indice par grade) est dans l'onglet « Grilles indiciaires ».
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
          Être dans la fenêtre ne garantit pas la bonification. Le statut promu / non promu est donné directement par
          le marqueur du rectorat lui-même — <strong>« Pro BA. »</strong> = promu, <strong>« BA. »</strong> seul =
          éligible mais pas promu — jamais estimé. Exception : pour les <strong>agrégés</strong>, la bonification se
          décide au niveau national (proposition ministérielle), donc ce fichier départemental ne permet pas de dire
          promu / non promu, seulement la candidature.
        </p>
      </section>
    </div>
  );
}
