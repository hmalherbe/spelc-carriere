import { useEffect, useMemo, useState } from "react";
import {
  ancienneteToBankingDays,
  bankingDaysToYMD,
  coefficientAppliqueFraction,
  computeReclassementConcours,
  computeReclassementConcoursDepuisHcExc,
  computeReclassementHcExc,
  GRILLES,
  joursComptablesEntre,
  joursRetenusPourService,
  parseAncienneteText,
  rangEchelon,
  seuilEntreeEchelon,
  SITUATIONS_AVANT_RECLASSEMENT,
  type EchelonCode,
  type GrilleCode,
  type ServiceAnterieur,
} from "@spelc/domain";
import { api, type ReclassementCas, type ReclassementSauvegarde } from "../api.js";

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

/** "Coefficient de reclassement" appliqué à un service, sous forme de fraction irréductible
 * (ex. "23/35"), ou "—" si la nature de service n'est pas (encore) reconnue. */
function coefficientLabel(nature: string, grilleCible: "AGR" | "PROFS"): string {
  try {
    const { numerateur, denominateur } = coefficientAppliqueFraction(nature, grilleCible);
    return `${numerateur}/${denominateur}`;
  } catch {
    return "—";
  }
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
  const [recherche, setRecherche] = useState(false);
  const [rechercheError, setRechercheError] = useState<string | null>(null);
  const [enregistrement, setEnregistrement] = useState(false);
  const [messageEnregistrement, setMessageEnregistrement] = useState<string | null>(null);

  /** Au plus un résultat possible par (cas, nom, prénom) — voir ReclassementSauvegarde (schema.
   * prisma) : enregistrer à nouveau pour le même enseignant remplace le précédent, donc il n'y a
   * jamais plusieurs enregistrements à choisir entre. */
  async function rechercher(nom: string, prenom: string): Promise<ReclassementSauvegarde | null> {
    if (!nom.trim() || !prenom.trim()) {
      setRechercheError("Nom et prénom requis pour recharger un reclassement enregistré.");
      return null;
    }
    setRecherche(true);
    setRechercheError(null);
    try {
      const trouve = await api.findReclassement(cas, nom, prenom);
      if (!trouve) setRechercheError(`Aucun reclassement enregistré pour ${nom} ${prenom}.`);
      return trouve;
    } catch (e) {
      setRechercheError(String(e));
      return null;
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

  return { recherche, rechercheError, rechercher, enregistrement, messageEnregistrement, enregistrer };
}

function BoutonCharger({ recherche, rechercheError, onRechercher }: { recherche: boolean; rechercheError: string | null; onRechercher: () => void }) {
  return (
    <div className="toolbar">
      <button type="button" className="secondary" onClick={onRechercher} disabled={recherche}>
        {recherche ? "Recherche en cours..." : "Charger le dernier reclassement enregistré (nom/prénom ci-dessus)"}
      </button>
      {rechercheError && <span className="error-text">{rechercheError}</span>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cas 1 — Reclt concours & reprise d'ancienneté
// ---------------------------------------------------------------------------

/** Les 3 méthodes de saisie d'une situation antérieure, mêmes libellés que l'ancien simulateur :
 * 1. Échelon + reliquat (dans le corps d'origine), 2. Période (dates), 3. Jours directs. */
type ModeSaisie = "echelon" | "periode" | "jours";

interface ServiceRow {
  id: string;
  nature: string;
  mode: ModeSaisie;
  // Situation 1 (échelon + reliquat) :
  echelonSituation1: string;
  priseEnCompteAnc: boolean;
  reliquatSituation1: string;
  // Situation 2 (période) et situation 1's own "début/fin situation" (mêmes champs, réutilisés) :
  dateDebut: string;
  dateFin: string;
  // Situation 3 (jours directs) :
  joursManuels: string;
  // Quotité, commune aux 3 situations :
  quotite: string;
}

function nouvelleServiceRow(initial?: Partial<ServiceRow>): ServiceRow {
  return {
    id: Math.random().toString(36).slice(2),
    nature: SITUATIONS_AVANT_RECLASSEMENT[0].nature,
    mode: "periode",
    echelonSituation1: "",
    priseEnCompteAnc: true,
    reliquatSituation1: "",
    dateDebut: "",
    dateFin: "",
    joursManuels: "",
    quotite: "",
    ...initial,
  };
}

/** Grille d'origine utilisée pour la base jours de la situation 1 — même correspondance que
 * l'ancien simulateur : Instituteur et MA 1/2/3 ont leur propre grille, tout le reste utilise
 * la grille "PROFS" (durées identiques à CERTIFIE/PEPS/PLP/Prof. des écoles). */
function grilleOrigineSituation1(nature: string): "PROFS" | "INSTIT" | "MA_1" {
  if (nature === "Instituteur") return "INSTIT";
  if (nature.startsWith("MA ")) return "MA_1";
  return "PROFS";
}

/** Jours bruts de la ligne AVANT pondération (quotité/coefficient) — le reliquat de la situation 1
 * n'en fait PAS partie : comme dans la formule réelle du classeur (colonne S = ROUND(ROUND(jours
 * pondérés,0)*ratio,0) + reliquat + bonus), le reliquat s'ajoute tel quel APRÈS la pondération, pas
 * dedans — voir calculer() plus bas, qui le passe à `reliquatJours`. */
function joursBrutsDeLaLigne(r: ServiceRow): number {
  if (r.mode === "jours") return Number(r.joursManuels) || 0;
  const periode = r.dateDebut && r.dateFin ? Math.max(0, joursComptablesEntre(r.dateDebut, r.dateFin)) : 0;
  if (r.mode === "periode") return periode;
  // mode === "echelon" (situation 1) : base jours de l'échelon (si "prise en compte anc.") + la
  // période éventuelle + le reliquat propre à cette situation — le reliquat est pondéré comme le
  // reste des jours bruts (coefficient, quotité), pas ajouté à part après coup.
  const echelon = Number(r.echelonSituation1) || 0;
  let base = 0;
  if (r.priseEnCompteAnc && echelon > 0) {
    try {
      base = seuilEntreeEchelon(grilleOrigineSituation1(r.nature), echelon);
    } catch {
      base = 0;
    }
  }
  return base + periode + (Number(r.reliquatSituation1) || 0);
}

/** Même construction qu'utilisée pour l'appel réel à computeReclassementConcours — partagée avec
 * l'affichage "Jours retenus" par ligne pour que les deux ne puissent jamais diverger. */
function construireServiceAnterieur(r: ServiceRow): ServiceAnterieur {
  return {
    nature: r.nature,
    joursBruts: joursBrutsDeLaLigne(r),
    quotite: r.quotite ? Number(r.quotite) : undefined,
  };
}

/** Jours réellement retenus pour cette ligne (après quotité, coefficient, reliquat et bonus
 * éventuel) — "—" si la nature de service n'est pas (encore) reconnue. */
function joursRetenusLabel(r: ServiceRow, grilleCible: "AGR" | "PROFS"): string {
  try {
    return `${joursRetenusPourService(construireServiceAnterieur(r), grilleCible)} j`;
  } catch {
    return "—";
  }
}

interface Cas1Parametres {
  grilleCible: "AGR" | "PROFS";
  dateEffet: string;
  rows: Omit<ServiceRow, "id">[];
}

function Cas1() {
  const [nom, setNom] = useState("");
  const [prenom, setPrenom] = useState("");
  const [grilleCible, setGrilleCible] = useState<"AGR" | "PROFS">("AGR");
  // Date d'effet du reclassement — purement informative (ne modifie aucun calcul, comme dans
  // l'outil d'origine) : la date à laquelle le reclassement décidé ici prend effet.
  const [dateEffet, setDateEffet] = useState("");
  const [rows, setRows] = useState<ServiceRow[]>([nouvelleServiceRow()]);
  const [result, setResult] = useState<ReturnType<typeof computeReclassementConcours> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const gestion = useReclassementGestion("CAS1");

  function updateRow(id: string, patch: Partial<ServiceRow>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function calculer() {
    try {
      const services: ServiceAnterieur[] = rows.map(construireServiceAnterieur);
      setResult(computeReclassementConcours({ grilleCible, services }));
      setError(null);
    } catch (e) {
      setError(String(e));
      setResult(null);
    }
  }

  async function charger() {
    const saved = await gestion.rechercher(nom, prenom);
    if (!saved) return;
    const params = saved.parametres as Cas1Parametres;
    setNom(saved.nom);
    setPrenom(saved.prenom);
    setGrilleCible(params.grilleCible);
    setDateEffet(params.dateEffet ?? "");
    setRows(params.rows.map((r) => nouvelleServiceRow(r)));
    setResult(saved.resultat as ReturnType<typeof computeReclassementConcours>);
    setError(null);
  }

  return (
    <div>
      <p className="hint">
        Chaque service antérieur est pondéré soit par un facteur direct, soit par le ratio entre le coefficient
        caractéristique de son corps d'origine et celui du corps cible, puis classé dans la grille cible selon le
        total retenu. La colonne "Jours bruts" est la durée saisie, avant pondération ; "Jours retenus" est ce qui
        est effectivement ajouté au total, après coefficient et quotité — la quotité n'a d'effet que si elle est
        strictement inférieure à un mi-temps (0,5), un temps partiel égal ou supérieur comptant comme un temps
        complet pour l'ancienneté.
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
        <label>
          Date d'effet du reclassement
          <input type="date" min="1960-01-01" max="2099-12-31" value={dateEffet} onChange={(e) => setDateEffet(e.target.value)} />
        </label>
      </div>

      <BoutonCharger recherche={gestion.recherche} rechercheError={gestion.rechercheError} onRechercher={charger} />

      <table className="data-table">
        <thead>
          <tr>
            <th>Nature du service</th>
            <th>Coefficient de reclassement</th>
            <th>Méthode de saisie</th>
            <th>Détail de la situation</th>
            <th>Quotité</th>
            <th>Jours bruts</th>
            <th>Jours retenus</th>
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
              <td>{coefficientLabel(r.nature, grilleCible)}</td>
              <td>
                <select value={r.mode} onChange={(e) => updateRow(r.id, { mode: e.target.value as ModeSaisie })}>
                  <option value="echelon">1. Par échelon et reliquat</option>
                  <option value="periode">2. Par période (dates)</option>
                  <option value="jours">3. Directement en jours</option>
                </select>
              </td>
              <td>
                {r.mode === "jours" && (
                  <input
                    type="number"
                    min={0}
                    placeholder="Jours"
                    value={r.joursManuels}
                    onChange={(e) => updateRow(r.id, { joursManuels: e.target.value })}
                  />
                )}
                {r.mode === "periode" && (
                  <span style={{ display: "flex", gap: 6 }}>
                    <input type="date" min="1960-01-01" max="2099-12-31" value={r.dateDebut} onChange={(e) => updateRow(r.id, { dateDebut: e.target.value })} />
                    <input type="date" min="1960-01-01" max="2099-12-31" value={r.dateFin} onChange={(e) => updateRow(r.id, { dateFin: e.target.value })} />
                  </span>
                )}
                {r.mode === "echelon" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <span style={{ display: "flex", gap: 6 }}>
                      <input
                        type="number"
                        min={1}
                        placeholder="Échelon"
                        value={r.echelonSituation1}
                        onChange={(e) => updateRow(r.id, { echelonSituation1: e.target.value })}
                      />
                      <select
                        value={r.priseEnCompteAnc ? "Oui" : "Non"}
                        onChange={(e) => updateRow(r.id, { priseEnCompteAnc: e.target.value === "Oui" })}
                      >
                        <option value="Oui">Prise en cpte anc. : Oui</option>
                        <option value="Non">Prise en cpte anc. : Non</option>
                      </select>
                    </span>
                    <span style={{ display: "flex", gap: 6 }}>
                      <input
                        type="date"
                        min="1960-01-01"
                        max="2099-12-31"
                        placeholder="Début situation"
                        value={r.dateDebut}
                        onChange={(e) => updateRow(r.id, { dateDebut: e.target.value })}
                      />
                      <input
                        type="date"
                        min="1960-01-01"
                        max="2099-12-31"
                        placeholder="Fin situation"
                        value={r.dateFin}
                        onChange={(e) => updateRow(r.id, { dateFin: e.target.value })}
                      />
                    </span>
                    <input
                      type="number"
                      min={0}
                      placeholder="Reliquat en jours"
                      value={r.reliquatSituation1}
                      onChange={(e) => updateRow(r.id, { reliquatSituation1: e.target.value })}
                    />
                  </div>
                )}
              </td>
              <td>
                <input type="number" min={0} max={1} step={0.1} placeholder="1" value={r.quotite} onChange={(e) => updateRow(r.id, { quotite: e.target.value })} />
              </td>
              <td>{joursBrutsDeLaLigne(r)} j</td>
              <td>{joursRetenusLabel(r, grilleCible)}</td>
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
          {dateEffet && (
            <p>
              Date d'effet du reclassement : <strong>{new Date(dateEffet).toLocaleDateString("fr-FR")}</strong>
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
                  { grilleCible, dateEffet, rows: rows.map(({ id: _id, ...rest }) => rest) } satisfies Cas1Parametres,
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
  { code: "EXC_PROFS", label: "Certifié / PEPS / PLP / Prof. des écoles — Classe exceptionnelle" },
  { code: "EXC_PEGC", label: "PEGC — Classe exceptionnelle" },
];

/** Les échelons possibles dépendent entièrement de la grille d'origine (ex. HC_PROFS : 1 à 7 ;
 * EXC_PROFS : 1 à 4 puis "HEA1"/"HEA2"/"HEA3" — les 3 derniers échelons de classe exceptionnelle,
 * calculatoirement identiques entre eux, voir rangEchelon/baseTheoriqueJours côté domaine) — un
 * simple champ numérique libre (ancien <input type="number">) laissait saisir n'importe quelle
 * valeur, y compris des échelons qui n'existent pas du tout dans la grille choisie. La valeur
 * stockée reste le code brut de GRILLES (ex. "A2") ; seul le libellé affiché est francisé en
 * "HEA2" pour coller à la terminologie du syndicat. */
function echelonOptionsCas2(grilleOrigine: GrilleCode): { value: string; label: string }[] {
  const rows = GRILLES[grilleOrigine] ?? [];
  return rows.map((r, i) => {
    const code = String(r.echelon);
    const label =
      grilleOrigine === "EXC_PROFS" && i >= 4
        ? `HEA${i - 3}` // 5e ligne ("5") -> HEA1, 6e ("A2") -> HEA2, 7e ("A3") -> HEA3
        : code;
    return { value: code, label };
  });
}

interface Cas2Parametres {
  grilleOrigine: GrilleCode;
  echelonActuel: string;
  dateEchelon: string;
  dateReclassement: string;
  reportAnciennete: string;
  ancienneteADeduire: string;
  grilleCible: "AGR" | "PROFS";
  biAdmissible: boolean;
  dateAccesEchelon11CN: string;
  dateAccesHorsClasse: string;
  dateAccesEchelon6HC: string;
  dateAccesEchelon7HC: string;
  dateAccesEchelon4EXC: string;
  dateAccesClasseExceptionnelle: string;
}

function Cas2() {
  const [nom, setNom] = useState("");
  const [prenom, setPrenom] = useState("");
  const [grilleOrigine, setGrilleOrigine] = useState<GrilleCode>("HC_PROFS");
  const [echelonActuel, setEchelonActuel] = useState<string>("1");
  const options = echelonOptionsCas2(grilleOrigine);
  const [dateEchelon, setDateEchelon] = useState("");
  const [dateReclassement, setDateReclassement] = useState("");
  // Corrections éventuelles de l'ancienneté dans l'échelon avant reclassement (Calculs!B41) —
  // mêmes champs "AAaMMmJJj" que les corrections "ancienneté à reporter/à déduire" déjà présentes
  // ailleurs dans l'application (Enseignants, Saisies manuelles).
  const [reportAnciennete, setReportAnciennete] = useState("");
  const [ancienneteADeduire, setAncienneteADeduire] = useState("");
  // Corps cible unique dans ce cas (contrairement au cas 1) : toujours Agrégé.
  const grilleCible = "AGR" as const;
  // Majorations d'ancienneté (décret 2022-708) — calculées à partir de ces dates d'accès, plutôt
  // que saisies directement en jours (voir Calculs!B47 du classeur).
  const [biAdmissible, setBiAdmissible] = useState(true);
  const [dateAccesEchelon11CN, setDateAccesEchelon11CN] = useState("");
  const [dateAccesHorsClasse, setDateAccesHorsClasse] = useState("");
  const [dateAccesEchelon6HC, setDateAccesEchelon6HC] = useState("");
  const [dateAccesEchelon7HC, setDateAccesEchelon7HC] = useState("");
  const [dateAccesEchelon4EXC, setDateAccesEchelon4EXC] = useState("");
  // Conditionne, pour EXC uniquement, si la majoration 6e échelon HC s'applique (A20 du classeur :
  // réforme de 2021 — voir anneeAccesClasseExceptionnelleEligible côté domaine).
  const [dateAccesClasseExceptionnelle, setDateAccesClasseExceptionnelle] = useState("");
  const [result, setResult] = useState<ReturnType<typeof computeReclassementConcoursDepuisHcExc> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const gestion = useReclassementGestion("CAS2");

  const processus: "HC" | "EXC" = grilleOrigine.startsWith("HC_") ? "HC" : "EXC";
  // Position de l'échelon dans sa grille d'origine (1er échelon -> 1, etc.) — PAS le code brut, qui
  // n'est pas toujours numérique (ex. EXC_PROFS: "A2"/"A3"). 0 par défaut le temps que l'effet
  // ci-dessous resynchronise `echelonActuel` après un changement de grille d'origine.
  let rang = 0;
  try {
    rang = rangEchelon(grilleOrigine, echelonActuel as EchelonCode);
  } catch {
    // échelon transitoire invalide pour la nouvelle grille — resynchronisé par l'effet ci-dessous
  }
  const montreCn11 = (processus === "HC" && rang >= 5) || (processus === "EXC" && rang >= 3);
  // Pour EXC, la majoration 6e échelon HC ne s'applique que si l'accès à la classe exceptionnelle
  // date de 2021 ou après (A20 du classeur, réforme 2021) — le champ de date lui-même reste
  // affiché dès l'échelon 4 pour pouvoir le renseigner, mais les deux dates 6e/7e échelon HC
  // n'apparaissent que si l'année saisie qualifie (ou toujours, côté HC, où la condition ne joue pas).
  const montreDateAccesClasseExceptionnelle = processus === "EXC" && rang >= 4;
  const anneeAccesExcEligible = Number(dateAccesClasseExceptionnelle.slice(0, 4)) >= 2021;
  const montreHc6 = (processus === "HC" && rang >= 7) || (processus === "EXC" && rang >= 4 && anneeAccesExcEligible);
  const montreExc4 = processus === "EXC" && rang >= 5;

  function calculer() {
    try {
      setResult(
        computeReclassementConcoursDepuisHcExc({
          grilleOrigine,
          echelonActuel,
          dateEchelon,
          dateReclassement,
          reportAnciennete: reportAnciennete.trim() || undefined,
          ancienneteADeduire: ancienneteADeduire.trim() || undefined,
          grilleCible,
          majorations: {
            biAdmissibleAgregation: biAdmissible,
            dateAccesEchelon11ClasseNormale: montreCn11 ? dateAccesEchelon11CN : undefined,
            dateAccesHorsClasse: montreCn11 ? dateAccesHorsClasse : undefined,
            dateAccesEchelon6HorsClasse: montreHc6 ? dateAccesEchelon6HC : undefined,
            dateAccesEchelon7HorsClasse: montreHc6 ? dateAccesEchelon7HC : undefined,
            dateAccesEchelon4ClasseExceptionnelle: montreExc4 ? dateAccesEchelon4EXC : undefined,
            dateAccesClasseExceptionnelle: montreDateAccesClasseExceptionnelle ? dateAccesClasseExceptionnelle : undefined,
          },
        }),
      );
      setError(null);
    } catch (e) {
      setError(String(e));
      setResult(null);
    }
  }

  async function charger() {
    const saved = await gestion.rechercher(nom, prenom);
    if (!saved) return;
    const params = saved.parametres as Cas2Parametres;
    setNom(saved.nom);
    setPrenom(saved.prenom);
    setGrilleOrigine(params.grilleOrigine);
    setEchelonActuel(params.echelonActuel);
    setDateEchelon(params.dateEchelon);
    setDateReclassement(params.dateReclassement);
    setReportAnciennete(params.reportAnciennete ?? "");
    setAncienneteADeduire(params.ancienneteADeduire ?? "");
    setBiAdmissible(params.biAdmissible ?? true);
    setDateAccesEchelon11CN(params.dateAccesEchelon11CN ?? "");
    setDateAccesHorsClasse(params.dateAccesHorsClasse ?? "");
    setDateAccesEchelon6HC(params.dateAccesEchelon6HC ?? "");
    setDateAccesEchelon7HC(params.dateAccesEchelon7HC ?? "");
    setDateAccesEchelon4EXC(params.dateAccesEchelon4EXC ?? "");
    setDateAccesClasseExceptionnelle(params.dateAccesClasseExceptionnelle ?? "");
    setResult(saved.resultat as ReturnType<typeof computeReclassementConcoursDepuisHcExc>);
    setError(null);
  }

  return (
    <div>
      <p className="hint">
        Pour un agent hors-classe ou classe exceptionnelle reçu à un concours d'un corps supérieur : reconstitution
        virtuelle dans la classe normale du corps cible, à partir d'une base théorique d'équivalence propre à
        l'échelon de départ, majorée le cas échéant (décret 2022-708) — calculée à partir des dates d'accès
        saisies ci-dessous, pas saisie directement en jours — puis convertie au coefficient du corps cible.
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
          <select
            value={grilleOrigine}
            onChange={(e) => {
              const nouvelleGrille = e.target.value as GrilleCode;
              setGrilleOrigine(nouvelleGrille);
              setEchelonActuel(echelonOptionsCas2(nouvelleGrille)[0]?.value ?? "1");
            }}
          >
            {GRILLES_ORIGINE_CAS2.map((g) => (
              <option key={g.code} value={g.code}>
                {g.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Échelon actuel
          <select value={echelonActuel} onChange={(e) => setEchelonActuel(e.target.value)}>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Date d'effet de l'échelon actuel
          <input type="date" min="1960-01-01" max="2099-12-31" value={dateEchelon} onChange={(e) => setDateEchelon(e.target.value)} />
        </label>
        <label>
          Date d'effet du reclassement
          <input type="date" min="1960-01-01" max="2099-12-31" value={dateReclassement} onChange={(e) => setDateReclassement(e.target.value)} />
        </label>
        <label>
          Report d'ancienneté (optionnel)
          <input placeholder='ex. "01a00m00j"' value={reportAnciennete} onChange={(e) => setReportAnciennete(e.target.value)} />
        </label>
        <label>
          Ancienneté à déduire (optionnel)
          <input placeholder='ex. "00a06m00j"' value={ancienneteADeduire} onChange={(e) => setAncienneteADeduire(e.target.value)} />
        </label>
      </div>
      <p className="hint">
        Report d'ancienneté et ancienneté à déduire, format "AAaMMmJJj" (années/mois/jours) — pris en compte dans
        l'ancienneté dans l'échelon avant reclassement.
      </p>

      <BoutonCharger recherche={gestion.recherche} rechercheError={gestion.rechercheError} onRechercher={charger} />

      {montreCn11 && (
        <div className="inline-form">
          <label>
            Bi-admissibilité à l'agrégation ?
            <select value={biAdmissible ? "Oui" : "Non"} onChange={(e) => setBiAdmissible(e.target.value === "Oui")}>
              <option value="Oui">Oui</option>
              <option value="Non">Non</option>
            </select>
          </label>
          <label>
            Date d'accès au 11ᵉ échelon de la classe normale
            <input type="date" min="1960-01-01" max="2099-12-31" value={dateAccesEchelon11CN} onChange={(e) => setDateAccesEchelon11CN(e.target.value)} />
          </label>
          <label>
            Date d'accès à la hors classe
            <input type="date" min="1960-01-01" max="2099-12-31" value={dateAccesHorsClasse} onChange={(e) => setDateAccesHorsClasse(e.target.value)} />
          </label>
        </div>
      )}
      {montreDateAccesClasseExceptionnelle && (
        <div className="inline-form">
          <label>
            Date d'accès à la classe exceptionnelle
            <input
              type="date"
              min="1960-01-01"
              max="2099-12-31"
              value={dateAccesClasseExceptionnelle}
              onChange={(e) => setDateAccesClasseExceptionnelle(e.target.value)}
            />
          </label>
          <p className="hint">
            La majoration 6ᵉ échelon de la hors classe ne s'applique, pour la classe exceptionnelle, que si cet accès
            date de 2021 ou après (réforme 2021) — les dates 6ᵉ/7ᵉ échelon n'apparaissent ci-dessous que dans ce cas.
          </p>
        </div>
      )}
      {montreHc6 && (
        <div className="inline-form">
          <label>
            Date d'accès au 6ᵉ échelon de la hors classe
            <input type="date" min="1960-01-01" max="2099-12-31" value={dateAccesEchelon6HC} onChange={(e) => setDateAccesEchelon6HC(e.target.value)} />
          </label>
          {/* Pour un Hors Classe à l'échelon 7 (le seul cas où processus === "HC" déclenche cette
             majoration), le classeur ne demande jamais cette date séparément — il réutilise la date
             d'accès à l'échelon actuel (`dateEchelon`, Calculs!B43, voir reclassementConcours.ts's
             majorationHC6). Un enseignant à l'échelon 7 EST déjà au 7e échelon depuis `dateEchelon` :
             lui redemander cette même date dans un second champ n'a pas de sens et laissait la
             majoration à 0 en silence faute de saisie (bug réel du 2026-10-31). Toujours nécessaire
             pour EXC en revanche (les deux dates y restent deux faits indépendants). */}
          {processus === "EXC" && (
            <label>
              Date d'accès au 7ᵉ échelon de la hors classe
              <input type="date" min="1960-01-01" max="2099-12-31" value={dateAccesEchelon7HC} onChange={(e) => setDateAccesEchelon7HC(e.target.value)} />
            </label>
          )}
        </div>
      )}
      {montreExc4 && (
        <div className="inline-form">
          <label>
            Date d'accès à l'échelon 4 de la classe exceptionnelle
            <input type="date" min="1960-01-01" max="2099-12-31" value={dateAccesEchelon4EXC} onChange={(e) => setDateAccesEchelon4EXC(e.target.value)} />
          </label>
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
          {dateReclassement && (
            <p>
              Date d'effet du reclassement : <strong>{new Date(dateReclassement).toLocaleDateString("fr-FR")}</strong>
            </p>
          )}
          <p>Base théorique d'équivalence : {result.baseTheoriqueJours} jours</p>
          <p>Ancienneté dans l'échelon : {result.joursAcquisDansEchelon} jours</p>
          <p>Majorations d'ancienneté calculées : {result.majorationsJours} jours</p>
          <p>
            Total avant coefficient : <strong>{result.totalAvantCoefficientJours} jours</strong>
          </p>
          <p>
            Coefficient de reclassement appliqué : {result.coefficientFraction.numerateur}/{result.coefficientFraction.denominateur}
          </p>
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
                  {
                    grilleOrigine,
                    echelonActuel,
                    dateEchelon,
                    dateReclassement,
                    reportAnciennete,
                    ancienneteADeduire,
                    grilleCible,
                    biAdmissible,
                    dateAccesEchelon11CN,
                    dateAccesHorsClasse,
                    dateAccesEchelon6HC,
                    dateAccesEchelon7HC,
                    dateAccesEchelon4EXC,
                    dateAccesClasseExceptionnelle,
                  } satisfies Cas2Parametres,
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
  grilleActuelle: GrilleCode;
  echelonActuel: string;
  dateDernierChangement: string;
  dateReference: string;
  reportAnciennete: string;
  ancienneteADeduire: string;
}

/** Libellé affiché pour l'échelon d'arrivée — le code brut stocké ne correspond pas toujours à la
 * terminologie du syndicat :
 * - EXC_PROFS (échelon 4 → chevron HEA1) réutilise la position déjà codée "échelon 5" dans
 *   GRILLES.EXC_PROFS (même indice, 895 — confirmé par l'utilisateur, 2026-11-01), mais ce code
 *   numérique seul ne dit rien du "chevron HEA1" : toujours un seul résultat possible pour cette
 *   transition, donc toujours ce même libellé fixe.
 * - Un code composite du classeur ("7-HEB2", CHAIRE_SUP) est affiché "7 - chevron HEB2" plutôt que
 *   tel quel. */
function formatNouvelEchelonLabel(grilleActuelle: GrilleCode, nouvelEchelon: EchelonCode): string {
  if (grilleActuelle === "EXC_PROFS") return "4 - chevron HEA1";
  const code = String(nouvelEchelon);
  const m = /^(\d+)-((?:HEA|HEB)\d)$/.exec(code);
  return m ? `${m[1]} - chevron ${m[2]}` : code;
}

/** Échelons de départ possibles — borne le champ "Échelon de départ" (un <input type="number">
 * libre jusqu'ici, laissait saisir n'importe quelle valeur sans rapport avec la grille/situation
 * choisie, ex. 14) selon les règles du syndicat (2026-11-01) :
 * - Classe normale (PROFS/AGR/BI_ADM/PEGC) : dépend de l'ancienneté dans l'échelon À LA DATE DU
 *   RECLASSEMENT — {10, 11} si < 720j (2 ans), {9, 10, 11} si >= 720j.
 * - Hors Classe Certifié/PEPS/PLP/Prof. des écoles (HC_PROFS) uniquement : {3, 4, 5, 6, 7} — PEGC
 *   et Agrégé Hors Classe (HC_PEGC/HC_AGR) gardent toutes les valeurs de leur propre grille,
 *   aucune restriction supplémentaire demandée pour eux.
 * - Classe exceptionnelle (EXC_PROFS) : un seul échelon possible, "4" (→ chevron HEA1).
 * - Chaire supérieure (CHAIRE_SUP) : un seul échelon possible, "6-HEA2" (→ 7-HEB2). */
function echelonOptionsCas3(processus: "HC" | "EXC", grilleActuelle: GrilleCode, ancienneteJoursAuReclassement: number): string[] {
  if (processus === "HC") return ancienneteJoursAuReclassement < 720 ? ["10", "11"] : ["9", "10", "11"];
  if (grilleActuelle === "HC_PROFS") return ["3", "4", "5", "6", "7"];
  if (grilleActuelle === "EXC_PROFS") return ["4"];
  if (grilleActuelle === "CHAIRE_SUP") return ["6-HEA2"];
  return (GRILLES[grilleActuelle] ?? []).map((r) => String(r.echelon));
}

function Cas3() {
  const [nom, setNom] = useState("");
  const [prenom, setPrenom] = useState("");
  const [processus, setProcessus] = useState<"HC" | "EXC">("HC");
  const [grilleActuelle, setGrilleActuelle] = useState<GrilleCode>("PROFS");
  const [echelonActuel, setEchelonActuel] = useState("10");
  const [dateDernierChangement, setDateDernierChangement] = useState("");
  const [dateReference, setDateReference] = useState("");
  // Corrections éventuelles de l'ancienneté dans l'échelon avant reclassement (Calculs!B17, même
  // mécanique que Cas2 — voir son propre commentaire).
  const [reportAnciennete, setReportAnciennete] = useState("");
  const [ancienneteADeduire, setAncienneteADeduire] = useState("");
  const [result, setResult] = useState<ReturnType<typeof computeReclassementHcExc> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const gestion = useReclassementGestion("CAS3");

  const optionsGrille = useMemo(
    () =>
      processus === "HC"
        ? [
            { code: "PROFS" as const, label: "Certifié / PEPS / PLP / Prof. des écoles" },
            { code: "AGR" as const, label: "Agrégé" },
            { code: "BI_ADM" as const, label: "Certifié / PEPS / PLP — Bi-admissible" },
            { code: "PEGC" as const, label: "PEGC" },
          ]
        : [
            { code: "HC_PROFS" as const, label: "Certifié / PEPS / PLP / Prof. des écoles — Hors Classe" },
            { code: "HC_AGR" as const, label: "Agrégé — Hors Classe" },
            { code: "HC_PEGC" as const, label: "PEGC — Hors Classe" },
            {
              code: "EXC_PROFS" as const,
              label: "Certifié / PEPS / PLP / Prof. des écoles — Classe exceptionnelle (échelon 4 → chevron HEA1)",
            },
            {
              code: "CHAIRE_SUP" as const,
              label: "Professeur de chaire supérieure (échelon 6-HEA2 → 7-HEB2)",
            },
          ],
    [processus],
  );

  // Ancienneté dans l'échelon À LA DATE DU RECLASSEMENT (pas juste la différence de dates brute :
  // les corrections report/déduire comptent aussi) — pilote, pour une classe normale, les échelons
  // de départ possibles (echelonOptionsCas3 ci-dessus), donc recalculée à chaque rendu plutôt que
  // seulement au clic sur "Calculer".
  const ancienneteJoursAuReclassement = Math.max(
    0,
    (dateDernierChangement && dateReference ? joursComptablesEntre(dateDernierChangement, dateReference) : 0) +
      ancienneteToBankingDays(parseAncienneteText(reportAnciennete.trim() || null)) -
      ancienneteToBankingDays(parseAncienneteText(ancienneteADeduire.trim() || null)),
  );
  const optionsEchelon = echelonOptionsCas3(processus, grilleActuelle, ancienneteJoursAuReclassement);

  // Resynchronise l'échelon sélectionné dès que les options changent (grille, ou franchissement du
  // seuil de 720j pour une classe normale) et que la valeur actuelle n'en fait plus partie.
  useEffect(() => {
    if (!optionsEchelon.includes(echelonActuel)) setEchelonActuel(optionsEchelon[0] ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optionsEchelon.join("|")]);

  function calculer() {
    try {
      setResult(
        computeReclassementHcExc({
          processus,
          grilleActuelle,
          // Numérique pour toutes les grilles sauf CHAIRE_SUP (seul échelon de départ possible :
          // le code composite "6-HEA2", pas convertible en nombre).
          echelonActuel: Number(echelonActuel) || echelonActuel,
          ancienneteJoursAuReference: ancienneteJoursAuReclassement,
          dateReference,
        }),
      );
      setError(null);
    } catch (e) {
      setError(String(e));
      setResult(null);
    }
  }

  async function charger() {
    const saved = await gestion.rechercher(nom, prenom);
    if (!saved) return;
    const params = saved.parametres as Cas3Parametres;
    setNom(saved.nom);
    setPrenom(saved.prenom);
    setProcessus(params.processus);
    setGrilleActuelle(params.grilleActuelle);
    setEchelonActuel(params.echelonActuel);
    setDateDernierChangement(params.dateDernierChangement);
    setDateReference(params.dateReference);
    setReportAnciennete(params.reportAnciennete ?? "");
    setAncienneteADeduire(params.ancienneteADeduire ?? "");
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
          <select value={grilleActuelle} onChange={(e) => setGrilleActuelle(e.target.value as GrilleCode)}>
            {optionsGrille.map((g) => (
              <option key={g.code} value={g.code}>
                {g.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Échelon de départ
          <select
            value={echelonActuel}
            disabled={optionsEchelon.length <= 1}
            onChange={(e) => setEchelonActuel(e.target.value)}
          >
            {optionsEchelon.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
          {processus === "HC" && (
            <span className="hint">
              {ancienneteJoursAuReclassement < 720
                ? "Ancienneté dans l'échelon < 2 ans à la date du reclassement : échelons 10 et 11 possibles."
                : "Ancienneté dans l'échelon ≥ 2 ans à la date du reclassement : échelons 9, 10 et 11 possibles."}
            </span>
          )}
        </label>
        <label>
          Date d'entrée dans cet échelon
          <input type="date" min="1960-01-01" max="2099-12-31" value={dateDernierChangement} onChange={(e) => setDateDernierChangement(e.target.value)} />
        </label>
        <label>
          Date d'effet du reclassement (rentrée de la campagne)
          <input type="date" min="1960-01-01" max="2099-12-31" value={dateReference} onChange={(e) => setDateReference(e.target.value)} />
        </label>
        <label>
          Report d'ancienneté (optionnel)
          <input placeholder='ex. "01a00m00j"' value={reportAnciennete} onChange={(e) => setReportAnciennete(e.target.value)} />
        </label>
        <label>
          Ancienneté à déduire (optionnel)
          <input placeholder='ex. "00a06m00j"' value={ancienneteADeduire} onChange={(e) => setAncienneteADeduire(e.target.value)} />
        </label>
      </div>
      <p className="hint">
        Report d'ancienneté et ancienneté à déduire, format "AAaMMmJJj" (années/mois/jours) — pris en compte dans
        l'ancienneté dans l'échelon avant reclassement.
      </p>

      <BoutonCharger recherche={gestion.recherche} rechercheError={gestion.rechercheError} onRechercher={charger} />

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
          {dateReference && (
            <p>
              Date d'effet du reclassement : <strong>{new Date(dateReference).toLocaleDateString("fr-FR")}</strong>
            </p>
          )}
          <p className="gain-positive">
            Nouvelle grille : {result.nouvelleGrille} — échelon {formatNouvelEchelonLabel(grilleActuelle, result.nouvelEchelon)}
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
                  {
                    processus,
                    grilleActuelle,
                    echelonActuel,
                    dateDernierChangement,
                    dateReference,
                    reportAnciennete,
                    ancienneteADeduire,
                  } satisfies Cas3Parametres,
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
