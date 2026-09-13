import { useState } from "react";
import { GrillesPage } from "./GrillesPage.js";

type ReclassementTab = "simulateur" | "donnees";

const TABS: { id: ReclassementTab; label: string }[] = [
  { id: "simulateur", label: "Simulateur" },
  { id: "donnees", label: "Données" },
];

export function ReclassementPage() {
  const [tab, setTab] = useState<ReclassementTab>("simulateur");

  return (
    <div className="import-page">
      <div className="page-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`page-tab-btn${tab === t.id ? " active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "simulateur" && (
        <>
          <p className="hint">
            Trois cas de reclassement : reprise d'ancienneté après un concours, reconstitution virtuelle depuis la
            hors-classe/classe exceptionnelle lors d'un concours, et échelon obtenu lors d'un passage à la hors-classe
            ou à la classe exceptionnelle. Purement local au navigateur (aucune donnée n'est envoyée ni enregistrée) —
            un outil autonome, pas encore relié aux données des enseignants suivis dans l'application. Les règles de
            calcul détaillées sont dans son propre onglet "Règles de calcul".
          </p>
          <iframe src="/reclassement-simulateur.html" title="Simulateur de reclassement" className="reclassement-frame" />
        </>
      )}

      {tab === "donnees" && <GrillesPage />}
    </div>
  );
}
