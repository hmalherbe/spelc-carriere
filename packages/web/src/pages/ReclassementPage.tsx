export function ReclassementPage() {
  return (
    <div className="import-page">
      <p className="hint">
        Simulateur de reclassement (grilles PPCR) — calcul de reprise d'ancienneté lors d'un concours, reconstitution
        virtuelle depuis la hors-classe/classe exceptionnelle, et échelon obtenu lors d'une promotion. Purement local au
        navigateur (aucune donnée n'est envoyée ni enregistrée) — un outil autonome, pas encore relié aux données des
        enseignants suivis dans l'application.
      </p>
      <iframe
        src="/reclassement-simulateur.html"
        title="Simulateur de reclassement"
        className="reclassement-frame"
      />
    </div>
  );
}
