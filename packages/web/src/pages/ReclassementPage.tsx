import { useState } from "react";
import { GrillesPage } from "./GrillesPage.js";

type ReclassementTab = "simulateur" | "donnees" | "regles";

const TABS: { id: ReclassementTab; label: string }[] = [
  { id: "simulateur", label: "Simulateur" },
  { id: "donnees", label: "Données" },
  { id: "regles", label: "Règles de calcul" },
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
            un outil autonome, pas encore relié aux données des enseignants suivis dans l'application.
          </p>
          <iframe src="/reclassement-simulateur.html" title="Simulateur de reclassement" className="reclassement-frame" />
        </>
      )}

      {tab === "donnees" && <GrillesPage />}

      {tab === "regles" && (
        <div className="import-page">
          <p className="hint">
            Ce simulateur applique strictement les règles de parité de l'article L914-1 du Code de l'éducation, en
            s'appuyant sur le décret de 1951 modifié (notamment par les décrets n° 2022-708 et n° 2023-729).
          </p>
          <section className="card">
            <h2>Reclt concours &amp; Reprise anc.</h2>
            <p>
              Calcul en jours sur une base comptable (années de 360 jours, mois de 30 jours). Chaque service antérieur
              est retenu soit par une pondération directe (ex. activités professionnelles), soit en appliquant le
              rapport entre le coefficient caractéristique du corps d'origine et celui du corps cible (jours du
              service × coefficient d'origine ÷ coefficient cible). Le total des jours ainsi retenus détermine
              l'échelon de classement dans le corps cible, le reste étant le report d'ancienneté conservé dans ce
              nouvel échelon.
            </p>
          </section>
          <section className="card">
            <h2>Reclt concours HC et EXC</h2>
            <p>
              Pour un agent en hors-classe ou en classe exceptionnelle reçu à un concours d'un corps supérieur : une
              reconstitution virtuelle de carrière dans la classe normale du corps d'origine, à partir d'une base
              théorique d'équivalence propre à chaque échelon HC/EXC, à laquelle s'ajoute l'ancienneté acquise dans
              l'échelon actuel et, le cas échéant, une majoration d'ancienneté (décret n° 2022-708) conservée
              au-delà de certains seuils — 11ᵉ échelon de la classe normale, 6ᵉ échelon de la hors-classe, 4ᵉ échelon
              de la classe exceptionnelle. Le total obtenu est ensuite converti au coefficient du corps cible (base
              agrégé, coefficient 175) pour déterminer l'échelon et le report d'ancienneté.
            </p>
          </section>
          <section className="card">
            <h2>Reclassement HC et EXC</h2>
            <p>
              Pour un passage de la classe normale à la hors-classe, ou de la hors-classe à la classe exceptionnelle :
              l'échelon d'arrivée dépend directement de l'échelon de départ, selon une correspondance fixée par les
              grilles. Cas particulier au 11ᵉ échelon de la classe normale : le report d'ancienneté déjà accumulé dans
              cet échelon détermine si l'agent est classé au 4ᵉ ou au 5ᵉ échelon de la hors-classe. Dans tous les cas,
              le report d'ancienneté acquis dans l'échelon d'origine est intégralement conservé dans le nouvel
              échelon.
            </p>
          </section>
        </div>
      )}
    </div>
  );
}
