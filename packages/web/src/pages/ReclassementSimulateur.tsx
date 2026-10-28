import { useMemo, useState } from "react";
import {
  bankingDaysToYMD,
  computeReclassementConcours,
  computeReclassementConcoursDepuisHcExc,
  computeReclassementHcExc,
  joursComptablesEntre,
  SITUATIONS_AVANT_RECLASSEMENT,
  type GrilleCode,
  type ServiceAnterieur,
} from "@spelc/domain";
import { api, type ReclassementCas, type ReclassementSauvegardeResume } from "../api.js";

/**
 * Remplace les 3 onglets de calcul de l'ancien simulateur HTML autonome (reclassement-
 * simulateur.html, retiré) par de vrais formulaires React branchés sur packages/domain —
 * toujours purement local au navigateur pour le CALCUL (aucune donnée envoyée ni enregistrée tant
 * qu'on ne clique pas "Enregistrer"), mais maintenant testé (packages/domain/test/
 * reclassementConcours.test.ts, hcExcReclassement.test.ts) et sans les écarts identifiés dans
 * l'ancien outil face aux vraies règles du classeur Excel du Spelc (bonus "Contractuel alternant",
 * plancher d'indice, arrondi floor/round, table de reclassement HC/EXC approximative).
 *
 * Un reclassement calculé peut être enregistré (nom/prénom + tous les paramètres saisis + le
 * résultat obtenu), et rechargé plus tard par nom/prénom — voir ReclassementSauvegarde (schema.
 * prisma) : le résultat rechargé est celui FIGÉ au moment de l'enregistrement, jamais recalculé,
 * pour qu'une décision déjà prise ne bouge pas silencieusement si les règles sont corrigées ensuite.
 */

type SimTab = "cas1" | "cas2" | "cas3" | "regles";

const TABS: { id: SimTab; label: string }[] = [
  { id: "cas1", label: "Reclt concours & Reprise anc." },
  { id: "cas2", label: "Reclt concours HC et EXC" },
  { id: "cas3", label: "Reclassement HC et EXC" },
  { id: "regles", label: "Règles de calcul" },
];

function formatJours(jours: number): string {
  const { annees, mois, jours: j } = bankingDaysToYMD(jours);
  return `${annees} année(s), ${mois} mois et ${j} jour(s)`;
}

export function ReclassementSimulateur() {
  const [tab, setTab] = useState<SimTab>("cas1");
  return (
    <div>
      <div className="page-tabs">
        {TABS.map((t) => (
          <button key={t.id} type="button" className={`page-tab-btn${tab === t.id ? " active" : ""}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === "cas1" && <Cas1 />}
      {tab === "cas2" && <Cas2 />}
      {tab === "cas3" && <Cas3 />}
      {tab === "regles" && <Regles />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Enregistrement / rechargement — partagé par les 3 cas de calcul
// ---------------------------------------------------------------------------

function useReclassementGestion(cas: ReclassementCas) {
  const [resultats, setResultats] = useState<ReclassementSauvegardeResume[]>([]);
  const [recherche, setRecherche] = useState(false);
  const [rechercheError, setRechercheError] = useState<string | null>(null);
  const [enregistrement, setEnregistrement] = useState(false);
  const [messageEnregistrement, setMessageEnregistrement] = useState<string | null>(null);
  const [chargementId, setChargementId] = useState<string | null>(null);
  const [chargementError, setChargementError] = useState<string | null>(null);

  async function rechercher(nom: string, prenom: string) {
    if (!nom.trim() && !prenom.trim()) {
      setRechercheError("Saisir au moins un nom ou un prénom pour rechercher.");
      return;
    }
    setRecherche(true);
    setRechercheError(null);
    try {
      const tous = await api.searchReclassements(nom, prenom);
      setResultats(tous.filter((r) => r.cas === cas));
    } catch (e) {
      setRechercheError(String(e));
    } finally {
      setRecherche(false);
    }
  }

  async function enregistrer(nom: string, prenom: string, parametres: unknown, resultat: unknown) {
    setEnregistrement(true);
    setMessageEnregistrement(null);
    try {
      await api.saveReclassement(cas, nom, prenom, parametres, resultat);
      setMessageEnregistrement("Reclassement enregistré.");
    } catch (e) {
      setMessageEnregistrement(`Échec de l'enregistrement : ${String(e)}`);
    } finally {
      setEnregistrement(false);
    }
  }

  async function charger(id: string) {
    setChargementId(id);
    setChargementError(null);
    try {
      return await api.getReclassement(id);
    } catch (e) {
      setChargementError(String(e));
      return null;
    } finally {
      setChargementId(null);
    }
  }

  return { resultats, recherche, rechercheError, rechercher, enregistrement, messageEnregistrement, enregistrer, chargementId, chargementError, charger };
}

function BlocRecherche({
  resultats,
  recherche,
  rechercheError,
  onRechercher,
  onCharger,
  chargementId,
  chargementError,
}: {
  resultats: ReclassementSauvegardeResume[];
  recherche: boolean;
  rechercheError: string | null;
  onRechercher: () => void;
  onCharger: (id: string) => void;
  chargementId: string | null;
  chargementError: string | null;
}) {
  return (
    <div className="toolbar">
      <button type="button" className="secondary" onClick={onRechercher} disabled={recherche}>
        {recherche ? "Recherche en cours..." : "Rechercher un reclassement enregistré (nom/prénom ci-dessus)"}
      </button>
      {rechercheError && <span className="error-text">{rechercheError}</span>}
      {chargementError && <span className="error-text">{chargementError}</span>}
      {resultats.length > 0 && (
        <select
          value=""
          onChange={(e) => {
            if (e.target.value) onCharger(e.target.value);
          }}
          disabled={chargementId != null}
        >
          <option value="">{resultats.length} résultat(s) — choisir pour recharger</option>
          {resultats.map((r) => (
            <option key={r.id} value={r.id}>
              {r.nom} {r.prenom} — enregistré le {new Date(r.savedAt).toLocaleDateString("fr-FR")}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cas 1 — Reclt concours & reprise d'ancienneté
// ---------------------------------------------------------------------------

interface ServiceRow {
  id: string;
  nature: string;
  dateDebut: string;
  dateFin: string;
  joursManuels: string;
  modeManuel: boolean;
  quotite: string;
  reliquat: string;
}

function nouvelleServiceRow(initial?: Partial<ServiceRow>): ServiceRow {
  return {
    id: Math.random().toString(36).slice(2),
    nature: SITUATIONS_AVANT_RECLASSEMENT[0].nature,
    dateDebut: "",
    dateFin: "",
    joursManuels: "",
    modeManuel: false,
    quotite: "",
    reliquat: "",
    ...initial,
  };
}

function joursBrutsDeLaLigne(r: ServiceRow): number {
  if (r.modeManuel) return Number(r.joursManuels) || 0;
  if (r.dateDebut && r.dateFin) return Math.max(0, joursComptablesEntre(r.dateDebut, r.dateFin));
  return 0;
}

interface Cas1Parametres {
  grilleCible: "AGR" | "PROFS";
  rows: Omit<ServiceRow, "id">[];
}

function Cas1() {
  const [nom, setNom] = useState("");
  const [prenom, setPrenom] = useState("");
  const [grilleCible, setGrilleCible] = useState<"AGR" | "PROFS">("AGR");
  const [rows, setRows] = useState<ServiceRow[]>([nouvelleServiceRow()]);
  const [result, setResult] = useState<ReturnType<typeof computeReclassementConcours> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const gestion = useReclassementGestion("CAS1");

  function updateRow(id: string, patch: Partial<ServiceRow>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function calculer() {
    try {
      const services: ServiceAnterieur[] = rows.map((r) => ({
        nature: r.nature,
        joursBruts: joursBrutsDeLaLigne(r),
        quotite: r.quotite ? Number(r.quotite) : undefined,
        reliquatJours: r.reliquat ? Number(r.reliquat) : undefined,
      }));
      setResult(computeReclassementConcours({ grilleCible, services }));
      setError(null);
    } catch (e) {
      setError(String(e));
      setResult(null);
    }
  }

  async function charger(id: string) {
    const saved = await gestion.charger(id);
    if (!saved) return;
    const params = saved.parametres as Cas1Parametres;
    setNom(saved.nom);
    setPrenom(saved.prenom);
    setGrilleCible(params.grilleCible);
    setRows(params.rows.map((r) => nouvelleServiceRow(r)));
    setResult(saved.resultat as ReturnType<typeof computeReclassementConcours>);
    setError(null);
  }

  return (
    <div>
      <p className="hint">
        Chaque service antérieur est pondéré soit par un facteur direct, soit par le ratio entre le coefficient
        caractéristique de son corps d'origine et celui du corps cible, puis classé dans la grille cible selon le
        total retenu.
      </p>
      <div className="inline-form">
        <label>
          Nom
          <input type="text" value={nom} onChange={(e) => setNom(e.target.value)} />
        </label>
        <label>
          Prénom
          <input type="text" value={prenom} onChange={(e) => setPrenom(e.target.value)} />
        </label>
        <label>
          Corps cible
          <select value={grilleCible} onChange={(e) => setGrilleCible(e.target.value as "AGR" | "PROFS")}>
            <option value="AGR">Agrégé (coefficient 175)</option>
            <option value="PROFS">Certifié / PE / PEPS / PLP / MD1 / MD2 (coefficient 135)</option>
          </select>
        </label>
      </div>

      <BlocRecherche
        resultats={gestion.resultats}
        recherche={gestion.recherche}
        rechercheError={gestion.rechercheError}
        onRechercher={() => gestion.rechercher(nom, prenom)}
        onCharger={charger}
        chargementId={gestion.chargementId}
        chargementError={gestion.chargementError}
      />

      <table className="data-table">
        <thead>
          <tr>
            <th>Nature du service</th>
            <th>Période (ou jours directs)</th>
            <th>Quotité</th>
            <th>Reliquat (jours)</th>
            <th>Jours bruts</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>
                <select value={r.nature} onChange={(e) => updateRow(r.id, { nature: e.target.value })}>
                  {SITUATIONS_AVANT_RECLASSEMENT.map((s) => (
                    <option key={s.nature} value={s.nature}>
                      {s.nature}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                {r.modeManuel ? (
                  <input
                    type="number"
                    min={0}
                    placeholder="Jours"
                    value={r.joursManuels}
                    onChange={(e) => updateRow(r.id, { joursManuels: e.target.value })}
                  />
                ) : (
                  <span style={{ display: "flex", gap: 6 }}>
                    <input type="date" min="1960-01-01" max="2099-12-31" value={r.dateDebut} onChange={(e) => updateRow(r.id, { dateDebut: e.target.value })} />
                    <input type="date" min="1960-01-01" max="2099-12-31" value={r.dateFin} onChange={(e) => updateRow(r.id, { dateFin: e.target.value })} />
                  </span>
                )}
                <label className="checkbox-label">
                  <input type="checkbox" checked={r.modeManuel} onChange={(e) => updateRow(r.id, { modeManuel: e.target.checked })} />
                  Saisir les jours directement
                </label>
              </td>
              <td>
                <input type="number" min={0} max={1} step={0.1} placeholder="1" value={r.quotite} onChange={(e) => updateRow(r.id, { quotite: e.target.value })} />
              </td>
              <td>
                <input type="number" min={0} placeholder="0" value={r.reliquat} onChange={(e) => updateRow(r.id, { reliquat: e.target.value })} />
              </td>
              <td>{joursBrutsDeLaLigne(r)} j</td>
              <td>
                <button type="button" className="secondary" onClick={() => setRows((prev) => prev.filter((x) => x.id !== r.id))} disabled={rows.length === 1}>
                  Retirer
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="secondary" onClick={() => setRows((prev) => [...prev, nouvelleServiceRow()])}>
        + Ajouter un service
      </button>

      <div className="toolbar">
        <button type="button" onClick={calculer}>
          Calculer le reclassement
        </button>
      </div>

      {error && <p className="error-text">{error}</p>}
      {result && (
        <div className="card">
          {(nom || prenom) && (
            <p>
              <strong>Agent :</strong> {nom} {prenom}
            </p>
          )}
          <p>
            Total de l'ancienneté retenue : <strong>{result.totalJoursRetenus} jours</strong>
          </p>
          <p className="gain-positive">Classement : échelon {result.echelon}</p>
          <p>
            Report d'ancienneté : <strong>{result.ancienneteReporteeJours} jours</strong> ({formatJours(result.ancienneteReporteeJours)})
          </p>
          <div className="toolbar">
            <button
              type="button"
              className="secondary"
              disabled={gestion.enregistrement || !nom.trim() || !prenom.trim()}
              onClick={() =>
                gestion.enregistrer(
                  nom,
                  prenom,
                  { grilleCible, rows: rows.map(({ id: _id, ...rest }) => rest) } satisfies Cas1Parametres,
                  result,
                )
              }
            >
              {gestion.enregistrement ? "Enregistrement..." : "Enregistrer ce reclassement"}
            </button>
            {!nom.trim() || !prenom.trim() ? <span className="hint">Nom et prénom requis pour enregistrer.</span> : null}
            {gestion.messageEnregistrement && <span className="hint">{gestion.messageEnregistrement}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cas 2 — Reclt concours HC et EXC (reconstitution virtuelle)
// ---------------------------------------------------------------------------

const GRILLES_ORIGINE_CAS2: { code: GrilleCode; label: string }[] = [
  { code: "HC_AGR", label: "Agrégé — Hors Classe" },
  { code: "HC_PROFS", label: "Certifié / PEPS / PLP / Prof. des écoles — Hors Classe" },
  { code: "HC_PEGC", label: "PEGC — Hors Classe" },
  { code: "EXC_AGR", label: "Agrégé — Classe exceptionnelle" },
  { code: "EXC_PROFS", label: "Certifié / PEPS / PLP / Prof. des écoles — Classe exceptionnelle" },
  { code: "EXC_PEGC", label: "PEGC — Classe exceptionnelle" },
];

interface Cas2Parametres {
  grilleOrigine: GrilleCode;
  echelonActuel: string;
  dateEchelon: string;
  dateReclassement: string;
  grilleCible: "AGR" | "PROFS";
  majCn11: string;
  majHc6: string;
  majExc4: string;
}

function Cas2() {
  const [nom, setNom] = useState("");
  const [prenom, setPrenom] = useState("");
  const [grilleOrigine, setGrilleOrigine] = useState<GrilleCode>("HC_PROFS");
  const [echelonActuel, setEchelonActuel] = useState("1");
  const [dateEchelon, setDateEchelon] = useState("");
  const [dateReclassement, setDateReclassement] = useState("");
  const [grilleCible, setGrilleCible] = useState<"AGR" | "PROFS">("AGR");
  const [majCn11, setMajCn11] = useState("");
  const [majHc6, setMajHc6] = useState("");
  const [majExc4, setMajExc4] = useState("");
  const [result, setResult] = useState<ReturnType<typeof computeReclassementConcoursDepuisHcExc> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const gestion = useReclassementGestion("CAS2");

  const processus: "HC" | "EXC" = grilleOrigine.startsWith("HC_") ? "HC" : "EXC";
  const ech = Number(echelonActuel) || 0;
  const montreCn11 = (processus === "HC" && ech >= 5) || (processus === "EXC" && ech >= 3);
  const montreHc6 = (processus === "HC" && ech >= 7) || (processus === "EXC" && ech >= 4);
  const montreExc4 = processus === "EXC" && ech >= 5;

  function calculer() {
    try {
      setResult(
        computeReclassementConcoursDepuisHcExc({
          grilleOrigine,
          echelonActuel: ech,
          dateEchelon,
          dateReclassement,
          grilleCible,
          majorations: {
            cn11Jours: montreCn11 ? Number(majCn11) || 0 : 0,
            hc6Jours: montreHc6 ? Number(majHc6) || 0 : 0,
            exc4Jours: montreExc4 ? Number(majExc4) || 0 : 0,
          },
        }),
      );
      setError(null);
    } catch (e) {
      setError(String(e));
      setResult(null);
    }
  }

  async function charger(id: string) {
    const saved = await gestion.charger(id);
    if (!saved) return;
    const params = saved.parametres as Cas2Parametres;
    setNom(saved.nom);
    setPrenom(saved.prenom);
    setGrilleOrigine(params.grilleOrigine);
    setEchelonActuel(params.echelonActuel);
    setDateEchelon(params.dateEchelon);
    setDateReclassement(params.dateReclassement);
    setGrilleCible(params.grilleCible);
    setMajCn11(params.majCn11);
    setMajHc6(params.majHc6);
    setMajExc4(params.majExc4);
    setResult(saved.resultat as ReturnType<typeof computeReclassementConcoursDepuisHcExc>);
    setError(null);
  }

  return (
    <div>
      <p className="hint">
        Pour un agent hors-classe ou classe exceptionnelle reçu à un concours d'un corps supérieur : reconstitution
        virtuelle dans la classe normale du corps cible, à partir d'une base théorique d'équivalence propre à
        l'échelon de départ, majorée le cas échéant (décret 2022-708), puis convertie au coefficient du corps cible.
      </p>
      <div className="inline-form">
        <label>
          Nom
          <input type="text" value={nom} onChange={(e) => setNom(e.target.value)} />
        </label>
        <label>
          Prénom
          <input type="text" value={prenom} onChange={(e) => setPrenom(e.target.value)} />
        </label>
        <label>
          Grade et échelon d'origine
          <select value={grilleOrigine} onChange={(e) => setGrilleOrigine(e.target.value as GrilleCode)}>
            {GRILLES_ORIGINE_CAS2.map((g) => (
              <option key={g.code} value={g.code}>
                {g.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Échelon actuel
          <input type="number" min={1} value={echelonActuel} onChange={(e) => setEchelonActuel(e.target.value)} />
        </label>
        <label>
          Date d'effet de l'échelon actuel
          <input type="date" min="1960-01-01" max="2099-12-31" value={dateEchelon} onChange={(e) => setDateEchelon(e.target.value)} />
        </label>
        <label>
          Date du reclassement
          <input type="date" min="1960-01-01" max="2099-12-31" value={dateReclassement} onChange={(e) => setDateReclassement(e.target.value)} />
        </label>
        <label>
          Corps cible
          <select value={grilleCible} onChange={(e) => setGrilleCible(e.target.value as "AGR" | "PROFS")}>
            <option value="AGR">Agrégé</option>
            <option value="PROFS">Certifié / PE / PEPS / PLP / MD1 / MD2</option>
          </select>
        </label>
      </div>

      <BlocRecherche
        resultats={gestion.resultats}
        recherche={gestion.recherche}
        rechercheError={gestion.rechercheError}
        onRechercher={() => gestion.rechercher(nom, prenom)}
        onCharger={charger}
        chargementId={gestion.chargementId}
        chargementError={gestion.chargementError}
      />

      {(montreCn11 || montreHc6 || montreExc4) && (
        <div className="inline-form">
          {montreCn11 && (
            <label>
              Majoration 11ᵉ échelon CN au-delà de 2a 6m (jours)
              <input type="number" min={0} value={majCn11} onChange={(e) => setMajCn11(e.target.value)} />
            </label>
          )}
          {montreHc6 && (
            <label>
              Majoration 6ᵉ échelon HC au-delà de 3 ans (jours)
              <input type="number" min={0} value={majHc6} onChange={(e) => setMajHc6(e.target.value)} />
            </label>
          )}
          {montreExc4 && (
            <label>
              Majoration 4ᵉ échelon EXC au-delà de 3 ans (jours)
              <input type="number" min={0} value={majExc4} onChange={(e) => setMajExc4(e.target.value)} />
            </label>
          )}
        </div>
      )}

      <div className="toolbar">
        <button type="button" onClick={calculer}>
          Calculer le reclassement
        </button>
      </div>

      {error && <p className="error-text">{error}</p>}
      {result && (
        <div className="card">
          {(nom || prenom) && (
            <p>
              <strong>Agent :</strong> {nom} {prenom}
            </p>
          )}
          <p>Base théorique d'équivalence : {result.baseTheoriqueJours} jours</p>
          <p>Ancienneté dans l'échelon : {result.joursAcquisDansEchelon} jours</p>
          <p>Total converti (coefficient du corps cible) : {result.totalReconstitueJours} jours</p>
          <p className="gain-positive">
            Nouveau grade : {result.nouvelleGrille === "AGR" ? "Agrégé" : "Certifié / PE / PEPS / PLP"} — échelon {result.nouvelEchelon}
          </p>
          <p>
            Report d'ancienneté : <strong>{result.ancienneteReporteeJours} jours</strong> ({formatJours(result.ancienneteReporteeJours)})
          </p>
          <p>
            Indice avant : {result.ancienIndice} — Indice après : {result.nouvelIndice}
            {result.nouvelIndice === result.ancienIndice && result.totalReconstitueJours > 0 && " (conservation de l'indice avant reclassement)"}
          </p>
          <p>
            Gain : {result.gainSalaireBrut} € brut / {result.gainSalaireNet} € net par mois
          </p>
          <div className="toolbar">
            <button
              type="button"
              className="secondary"
              disabled={gestion.enregistrement || !nom.trim() || !prenom.trim()}
              onClick={() =>
                gestion.enregistrer(
                  nom,
                  prenom,
                  { grilleOrigine, echelonActuel, dateEchelon, dateReclassement, grilleCible, majCn11, majHc6, majExc4 } satisfies Cas2Parametres,
                  result,
                )
              }
            >
              {gestion.enregistrement ? "Enregistrement..." : "Enregistrer ce reclassement"}
            </button>
            {!nom.trim() || !prenom.trim() ? <span className="hint">Nom et prénom requis pour enregistrer.</span> : null}
            {gestion.messageEnregistrement && <span className="hint">{gestion.messageEnregistrement}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cas 3 — Reclassement HC et EXC (réutilise computeReclassementHcExc, déjà validé)
// ---------------------------------------------------------------------------

interface Cas3Parametres {
  processus: "HC" | "EXC";
  grilleActuelle: "PROFS" | "AGR" | "HC_PROFS" | "HC_AGR";
  echelonActuel: string;
  dateDernierChangement: string;
  dateReference: string;
}

function Cas3() {
  const [nom, setNom] = useState("");
  const [prenom, setPrenom] = useState("");
  const [processus, setProcessus] = useState<"HC" | "EXC">("HC");
  const [grilleActuelle, setGrilleActuelle] = useState<"PROFS" | "AGR" | "HC_PROFS" | "HC_AGR">("PROFS");
  const [echelonActuel, setEchelonActuel] = useState("9");
  const [dateDernierChangement, setDateDernierChangement] = useState("");
  const [dateReference, setDateReference] = useState("");
  const [result, setResult] = useState<ReturnType<typeof computeReclassementHcExc> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const gestion = useReclassementGestion("CAS3");

  const optionsGrille = useMemo(
    () =>
      processus === "HC"
        ? [
            { code: "PROFS" as const, label: "Certifié / PEPS / PLP / Prof. des écoles" },
            { code: "AGR" as const, label: "Agrégé" },
          ]
        : [
            { code: "HC_PROFS" as const, label: "Certifié / PEPS / PLP / Prof. des écoles — Hors Classe" },
            { code: "HC_AGR" as const, label: "Agrégé — Hors Classe" },
          ],
    [processus],
  );

  function calculer() {
    try {
      setResult(
        computeReclassementHcExc({
          processus,
          grilleActuelle,
          echelonActuel: Number(echelonActuel) || 0,
          ancienneteJoursAuReference: dateDernierChangement && dateReference ? Math.max(0, joursComptablesEntre(dateDernierChangement, dateReference)) : 0,
          dateReference,
        }),
      );
      setError(null);
    } catch (e) {
      setError(String(e));
      setResult(null);
    }
  }

  async function charger(id: string) {
    const saved = await gestion.charger(id);
    if (!saved) return;
    const params = saved.parametres as Cas3Parametres;
    setNom(saved.nom);
    setPrenom(saved.prenom);
    setProcessus(params.processus);
    setGrilleActuelle(params.grilleActuelle);
    setEchelonActuel(params.echelonActuel);
    setDateDernierChangement(params.dateDernierChangement);
    setDateReference(params.dateReference);
    setResult(saved.resultat as ReturnType<typeof computeReclassementHcExc>);
    setError(null);
  }

  return (
    <div>
      <p className="hint">
        Passage de la classe normale à la hors-classe, ou de la hors-classe à la classe exceptionnelle : l'échelon
        d'arrivée dépend directement de l'échelon de départ et de l'ancienneté dans cet échelon, selon la
        correspondance fixée par les grilles (report d'ancienneté intégralement conservé, sauf cas particulier du
        départ de l'échelon 9).
      </p>
      <div className="inline-form">
        <label>
          Nom
          <input type="text" value={nom} onChange={(e) => setNom(e.target.value)} />
        </label>
        <label>
          Prénom
          <input type="text" value={prenom} onChange={(e) => setPrenom(e.target.value)} />
        </label>
        <label>
          Type de passage
          <select
            value={processus}
            onChange={(e) => {
              const p = e.target.value as "HC" | "EXC";
              setProcessus(p);
              setGrilleActuelle(p === "HC" ? "PROFS" : "HC_PROFS");
            }}
          >
            <option value="HC">Classe normale → Hors Classe</option>
            <option value="EXC">Hors Classe → Classe exceptionnelle</option>
          </select>
        </label>
        <label>
          Grade
          <select value={grilleActuelle} onChange={(e) => setGrilleActuelle(e.target.value as "PROFS" | "AGR" | "HC_PROFS" | "HC_AGR")}>
            {optionsGrille.map((g) => (
              <option key={g.code} value={g.code}>
                {g.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Échelon de départ
          <input type="number" min={1} value={echelonActuel} onChange={(e) => setEchelonActuel(e.target.value)} />
        </label>
        <label>
          Date d'entrée dans cet échelon
          <input type="date" min="1960-01-01" max="2099-12-31" value={dateDernierChangement} onChange={(e) => setDateDernierChangement(e.target.value)} />
        </label>
        <label>
          Date de référence de la campagne (rentrée)
          <input type="date" min="1960-01-01" max="2099-12-31" value={dateReference} onChange={(e) => setDateReference(e.target.value)} />
        </label>
      </div>

      <BlocRecherche
        resultats={gestion.resultats}
        recherche={gestion.recherche}
        rechercheError={gestion.rechercheError}
        onRechercher={() => gestion.rechercher(nom, prenom)}
        onCharger={charger}
        chargementId={gestion.chargementId}
        chargementError={gestion.chargementError}
      />

      <div className="toolbar">
        <button type="button" onClick={calculer}>
          Calculer le reclassement
        </button>
      </div>

      {error && <p className="error-text">{error}</p>}
      {result && (
        <div className="card">
          {(nom || prenom) && (
            <p>
              <strong>Agent :</strong> {nom} {prenom}
            </p>
          )}
          <p className="gain-positive">
            Nouvelle grille : {result.nouvelleGrille} — échelon {result.nouvelEchelon}
          </p>
          <p>
            Report d'ancienneté : <strong>{result.ancienneteReporteeJours} jours</strong> ({formatJours(result.ancienneteReporteeJours)})
          </p>
          <p>
            Indice avant : {result.ancienIndice} — Indice après : {result.nouvelIndice}
          </p>
          <p>
            Gain : {result.gainSalaireBrut} € brut / {result.gainSalaireNet} € net par mois
          </p>
          <p>Prochaine promotion : {result.dateProchainePromotion ?? "déjà au sommet de la grille"}</p>
          <div className="toolbar">
            <button
              type="button"
              className="secondary"
              disabled={gestion.enregistrement || !nom.trim() || !prenom.trim()}
              onClick={() =>
                gestion.enregistrer(
                  nom,
                  prenom,
                  { processus, grilleActuelle, echelonActuel, dateDernierChangement, dateReference } satisfies Cas3Parametres,
                  result,
                )
              }
            >
              {gestion.enregistrement ? "Enregistrement..." : "Enregistrer ce reclassement"}
            </button>
            {!nom.trim() || !prenom.trim() ? <span className="hint">Nom et prénom requis pour enregistrer.</span> : null}
            {gestion.messageEnregistrement && <span className="hint">{gestion.messageEnregistrement}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Règles de calcul
// ---------------------------------------------------------------------------

function Regles() {
  return (
    <div>
      <p className="hint">
        Ce simulateur applique les règles de parité de l'Art. L914-1 du Code de l'éducation, en s'appuyant sur le
        Décret de 1951 modifié (notamment par les décrets 2022-708 et 2023-729) — porté depuis le classeur de calcul
        du Spelc (voir packages/domain/src/calculations/reclassementConcours.ts et hcExcReclassement.ts).
      </p>
      <div className="card">
        <h3>1. Reclt concours &amp; Reprise anc.</h3>
        <ul>
          <li>Calcul en jours sur une base comptable (années de 360 jours, mois de 30 jours).</li>
          <li>
            Chaque service antérieur est retenu soit par une pondération directe, soit en appliquant le rapport
            entre le coefficient caractéristique du corps d'origine et celui du corps cible.
          </li>
          <li>Un temps partiel à 50% ou plus compte comme un temps complet pour cette ancienneté.</li>
          <li>Un service "Contractuel alternant" bénéficie d'un bonus forfaitaire de 2 mois (60 jours).</li>
          <li>Le total des jours ainsi retenus détermine l'échelon de classement, le reste étant le report d'ancienneté.</li>
        </ul>
      </div>
      <div className="card">
        <h3>2. Reclt concours HC et EXC</h3>
        <ul>
          <li>
            Reconstitution virtuelle dans la classe normale du corps cible, à partir d'une base théorique
            d'équivalence propre à chaque échelon HC/EXC.
          </li>
          <li>
            Majorations d'ancienneté (décret 2022-708) au-delà de certains seuils (11ᵉ échelon classe normale, 6ᵉ
            hors-classe, 4ᵉ classe exceptionnelle).
          </li>
          <li>Le total obtenu est converti au coefficient du corps cible pour déterminer l'échelon et le report.</li>
          <li>Un reclassement ne peut jamais faire perdre l'indice déjà détenu avant le concours.</li>
        </ul>
      </div>
      <div className="card">
        <h3>3. Reclassement HC et EXC</h3>
        <ul>
          <li>
            Correspondance directe entre l'échelon de départ et l'échelon d'arrivée, fixée par les grilles de
            reclassement.
          </li>
          <li>Cas particulier du 11ᵉ échelon : le report d'ancienneté déjà accumulé détermine l'échelon d'arrivée (4 ou 5).</li>
          <li>Le report d'ancienneté est intégralement conservé, sauf cas particulier du départ de l'échelon 9.</li>
        </ul>
      </div>
    </div>
  );
}
