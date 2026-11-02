import { useEffect, useMemo, useState } from "react";
import {
  api,
  downloadBlob,
  type HcExcMailingKind,
  type HcExcMailingRecipient,
  type MailingLogEntry,
  type MailingPreview,
  type MailingSendResult,
} from "../api.js";
import { labelForCampagneCandidate } from "../CampagneContext.js";
import { useHcExcCampagneSelection } from "../hcExcCampagneSelection.js";
import { formatPrenom } from "../format.js";

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("fr-FR");
}

/** Même convention que buildMailingPdfFileName (MailingPage.tsx) côté échelon : le nom proposé par
 * le navigateur avant enregistrement vient d'ici, pas du Content-Disposition de la réponse. */
function buildHcExcPdfFileName(
  campagne: { dateCcma: string; commission: "CCMA" | "CCMI" | null; nature: "ECHELON" | "HC" | "EXC" | null } | null,
  kind: HcExcMailingKind,
): string {
  const today = new Date().toISOString().slice(0, 10);
  const dateCcma = campagne?.dateCcma ? campagne.dateCcma.slice(0, 10) : today;
  const commission = campagne?.commission ?? "CCMA";
  const nature = campagne?.nature ?? "HC";
  return `${today}_Projet_mailing_${nature}_${kind}_${commission}_${dateCcma}.pdf`;
}

/**
 * Mailing Hors Classe/Classe exceptionnelle — deux envois distincts dans la même campagne (voir
 * MailingLog.kind, schema.prisma) : "résultat" (tout le monde, promu ou non — adhérent ou pas) et
 * "reclassement" (uniquement les adhérents promus, calculé via computeReclassementHcExc). Toute
 * l'infra d'envoi (Brevo, mode test, historique, désabonnement) est partagée avec le mailing
 * échelon — seul le contenu diffère (voir hcExcResultatTemplate.ts/hcExcReclassementTemplate.ts).
 */
export function HcExcMailingPage() {
  // Sélection locale (pas le sélecteur de commission global) : voir hcExcCampagneSelection.ts's
  // own doc comment — nécessaire pour distinguer explicitement une campagne HC d'une campagne EXC
  // de même commission.
  const { campagnes, campagneId, setCampagneId, selectedCampagne } = useHcExcCampagneSelection();
  const resultatLabel = selectedCampagne?.commission === "CCMA" ? "Résultat de la CCMA" : "Résultat de la CCMI";
  const [kind, setKind] = useState<HcExcMailingKind>("resultat");
  const [recipients, setRecipients] = useState<HcExcMailingRecipient[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ teacherId: string; data: MailingPreview } | null>(null);
  const [previewLoading, setPreviewLoading] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<MailingSendResult | null>(null);
  const [mailingLog, setMailingLog] = useState<MailingLogEntry[]>([]);
  const [decisionBusyId, setDecisionBusyId] = useState<string | null>(null);
  const [savingIsAdherentId, setSavingIsAdherentId] = useState<string | null>(null);
  const [editingEmailId, setEditingEmailId] = useState<string | null>(null);
  const [emailDraft, setEmailDraft] = useState("");
  const [savingEmail, setSavingEmail] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [generatingText, setGeneratingText] = useState(false);
  const [textError, setTextError] = useState<string | null>(null);

  function refresh() {
    if (!campagneId) {
      setRecipients([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    Promise.all([api.hcExcMailingEligible(campagneId, kind), api.hcExcMailingLog(campagneId, kind)])
      .then(([r, log]) => {
        setRecipients(r);
        setMailingLog(log);
        setSelected(new Set());
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }

  useEffect(refresh, [campagneId, kind]);

  const selectableIds = useMemo(() => recipients.filter((r) => r.email && !r.optedOut).map((r) => r.teacherId), [recipients]);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));

  function toggle(teacherId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(teacherId)) next.delete(teacherId);
      else next.add(teacherId);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(selectableIds));
  }

  async function openPreview(teacherId: string) {
    if (!campagneId) return;
    setPreviewLoading(teacherId);
    try {
      const data = await api.hcExcMailingPreview(campagneId, teacherId, kind);
      setPreview({ teacherId, data });
    } catch (e) {
      setError(String(e));
    } finally {
      setPreviewLoading(null);
    }
  }

  /** Override d'affichage (Teacher.isAdherentCorrige, partagé avec le mailing échelon) — formule de
   * politesse + lien de désabonnement seulement, ne change jamais l'adresse d'envoi. */
  async function saveIsAdherent(teacherId: string, value: string) {
    const isAdherent = value === "adherent" ? true : value === "non_adherent" ? false : null;
    setSavingIsAdherentId(teacherId);
    setError(null);
    try {
      await api.updateMailingIsAdherent(teacherId, isAdherent);
      refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setSavingIsAdherentId(null);
    }
  }

  function startEditEmail(r: HcExcMailingRecipient) {
    setEditingEmailId(r.teacherId);
    setEmailDraft(r.email ?? "");
    setEmailError(null);
  }

  /** Même endpoint partagé que le mailing échelon (PUT /mailing/:teacherId/email) — écrit
   * directement Adherent.mailPersonnel (adhérent) ou AcademicEmail (non-adhérent, par nom/prénom),
   * la même source que celle lue pour résoudre l'adresse affichée ici. */
  async function saveEmail(teacherId: string) {
    setSavingEmail(true);
    setEmailError(null);
    try {
      await api.updateMailingEmail(teacherId, emailDraft);
      setEditingEmailId(null);
      refresh();
    } catch (e) {
      setEmailError(String(e));
    } finally {
      setSavingEmail(false);
    }
  }

  /** Override manuel de la décision de promotion — null (auto) revient au marqueur "Choix du
   * Recteur" du fichier rectorat (voir HcExcSnapshot.decisionManuelle's own doc comment). */
  async function changeDecision(hcExcSnapshotId: string, value: "auto" | "promu" | "non_promu") {
    setDecisionBusyId(hcExcSnapshotId);
    setError(null);
    try {
      await api.updateHcExcDecision(hcExcSnapshotId, value === "auto" ? null : value === "promu");
      refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setDecisionBusyId(null);
    }
  }

  async function send() {
    if (!campagneId || selected.size === 0) return;
    setSending(true);
    setSendResult(null);
    setError(null);
    try {
      const result = await api.hcExcMailingSend(campagneId, kind, Array.from(selected));
      setSendResult(result);
      refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setSending(false);
    }
  }

  async function generatePdf() {
    if (!campagneId || selected.size === 0) return;
    setGeneratingPdf(true);
    setPdfError(null);
    try {
      const blob = await api.hcExcMailingPdf(campagneId, kind, Array.from(selected));
      downloadBlob(blob, buildHcExcPdfFileName(selectedCampagne, kind));
    } catch (e) {
      setPdfError(String(e));
    } finally {
      setGeneratingPdf(false);
    }
  }

  async function generateText() {
    if (!campagneId || selected.size === 0) return;
    setGeneratingText(true);
    setTextError(null);
    try {
      const blob = await api.hcExcMailingText(campagneId, kind, Array.from(selected));
      downloadBlob(blob, `mailing-${kind}-${selectedCampagne?.anneeScolaire ?? campagneId}.txt`);
    } catch (e) {
      setTextError(String(e));
    } finally {
      setGeneratingText(false);
    }
  }

  if (error) return <p className="error-text">{error}</p>;

  return (
    <div>
      <div className="toolbar">
        <h2>Mailing Hors Classe / Classe exceptionnelle</h2>
        {campagnes.length > 0 && (
          <select value={campagneId ?? ""} onChange={(e) => setCampagneId(e.target.value)}>
            {campagnes.map((c) => (
              <option key={c.id} value={c.id}>
                {labelForCampagneCandidate(c, 2)}
              </option>
            ))}
          </select>
        )}
        <select value={kind} onChange={(e) => setKind(e.target.value as HcExcMailingKind)}>
          <option value="resultat">{resultatLabel}</option>
          <option value="reclassement">Reclassement (adhérents promus)</option>
        </select>
      </div>
      {campagnes.length === 0 && (
        <p className="hint">
          Aucune campagne Hors classe / Classe exceptionnelle pour l'année scolaire sélectionnée — créez-la depuis la
          page "Enseignants promouvables", ou changez d'année scolaire dans l'en-tête.
        </p>
      )}
      <p className="hint">
        {kind === "resultat"
          ? "Informe chaque enseignant (adhérent ou non) du résultat de son examen à la CCMA/CCMI — rang, appréciation du recteur, et la décision de promotion (\"Choix du Recteur\" du fichier rectorat par défaut, modifiable ci-dessous)."
          : "Calcule et annonce le reclassement (échelon, report d'ancienneté, gain de salaire, prochaine promotion) — réservé aux adhérents effectivement promus."}
      </p>

      <div className="toolbar">
        <button type="button" className="secondary" onClick={generatePdf} disabled={selected.size === 0 || generatingPdf}>
          {generatingPdf ? "Génération en cours..." : "Générer PDF"}
        </button>
        <button type="button" className="secondary" onClick={generateText} disabled={selected.size === 0 || generatingText}>
          {generatingText ? "Génération en cours..." : "Exporter en texte"}
        </button>
      </div>
      {pdfError && <p className="error-text">{pdfError}</p>}
      {textError && <p className="error-text">{textError}</p>}

      {loading ? (
        <p>Chargement...</p>
      ) : recipients.length === 0 ? (
        <p className="hint">Aucun destinataire pour cette campagne et ce type d'envoi.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>
                <input type="checkbox" checked={allSelected} onChange={toggleAll} />
              </th>
              <th>Nom</th>
              <th>Prénom</th>
              <th>Adhérent</th>
              <th>Grade</th>
              {kind === "resultat" ? (
                <>
                  <th>Rang</th>
                  <th>Vivier</th>
                  <th>Décision</th>
                </>
              ) : (
                <>
                  <th>Nouveau grade</th>
                  <th>Nouvel échelon</th>
                  <th>Gain net/mois</th>
                  <th>Prochaine promotion</th>
                </>
              )}
              <th>E-mail</th>
              <th>Dernier envoi</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {recipients.map((r) => (
              <tr key={r.teacherId}>
                <td>
                  <input type="checkbox" checked={selected.has(r.teacherId)} disabled={!r.email || r.optedOut} onChange={() => toggle(r.teacherId)} />
                </td>
                <td>{r.nom}</td>
                <td>{formatPrenom(r.prenom)}</td>
                <td>
                  <select
                    value={r.isAdherent ? "adherent" : "non_adherent"}
                    disabled={savingIsAdherentId === r.teacherId}
                    onChange={(e) => saveIsAdherent(r.teacherId, e.target.value)}
                    title="Affichage seulement (formule de politesse + lien de désabonnement) — ne change jamais l'adresse d'envoi, toujours celle du vrai rapprochement adhérent."
                  >
                    <option value="">(auto)</option>
                    <option value="adherent">Adhérent</option>
                    <option value="non_adherent">Non adhérent</option>
                  </select>
                </td>
                <td>{r.grade}</td>
                {kind === "resultat" ? (
                  <>
                    <td>{r.rang}</td>
                    <td>{r.vivier ?? "—"}</td>
                    <td>
                      <select
                        value={r.decisionManuelle == null ? "auto" : r.decisionManuelle ? "promu" : "non_promu"}
                        disabled={decisionBusyId === r.hcExcSnapshotId}
                        onChange={(e) => changeDecision(r.hcExcSnapshotId, e.target.value as "auto" | "promu" | "non_promu")}
                      >
                        <option value="auto">Auto ({r.choixRecteur ? "Promu" : "Non promu"} — choix du recteur)</option>
                        <option value="promu">Promu (forcé)</option>
                        <option value="non_promu">Non promu (forcé)</option>
                      </select>
                    </td>
                  </>
                ) : (
                  <>
                    <td>{r.nouveauGrade ?? "—"}</td>
                    <td>{r.nouvelEchelon ?? "—"}</td>
                    <td>{r.gainSalaireNet != null ? `${r.gainSalaireNet} €` : "—"}</td>
                    <td>{formatDate(r.dateProchainePromotion)}</td>
                  </>
                )}
                <td>
                  {editingEmailId === r.teacherId ? (
                    <div className="row-actions">
                      <input
                        type="email"
                        value={emailDraft}
                        onChange={(e) => setEmailDraft(e.target.value)}
                        placeholder="adresse@exemple.fr"
                        autoFocus
                      />
                      <button type="button" onClick={() => saveEmail(r.teacherId)} disabled={savingEmail}>
                        {savingEmail ? "..." : "Enregistrer"}
                      </button>
                      <button type="button" className="secondary" onClick={() => setEditingEmailId(null)} disabled={savingEmail}>
                        Annuler
                      </button>
                      {emailError && <span className="error-text">{emailError}</span>}
                    </div>
                  ) : (
                    <div className="row-actions">
                      {r.email ?? <span className="error-text">Aucune adresse</span>}
                      <button type="button" className="secondary" onClick={() => startEditEmail(r)}>
                        {r.email ? "Modifier" : "Ajouter"}
                      </button>
                    </div>
                  )}
                  {r.optedOut && (
                    <>
                      {" "}
                      <span className="hint">(désabonné)</span>
                    </>
                  )}
                </td>
                <td>
                  {r.lastStatus === "SENT" ? (
                    <span className="badge badge-promu_estime">Envoyé</span>
                  ) : r.lastStatus === "FAILED" ? (
                    <span className="badge badge-non_promu_estime">Échec</span>
                  ) : (
                    <span className="hint">—</span>
                  )}
                </td>
                <td>
                  <button type="button" className="secondary" onClick={() => openPreview(r.teacherId)} disabled={previewLoading === r.teacherId}>
                    {previewLoading === r.teacherId ? "..." : "Aperçu"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="toolbar" style={{ marginTop: 16 }}>
        <button type="button" onClick={send} disabled={selected.size === 0 || sending}>
          {sending ? "Envoi en cours..." : `Envoyer (${selected.size})`}
        </button>
      </div>

      {sendResult && (
        <p className="hint">
          {sendResult.testMode && <strong>[Mode test] </strong>}
          {sendResult.sent} envoyé(s), {sendResult.failed} échec(s)
          {sendResult.skippedOptedOut > 0 && `, ${sendResult.skippedOptedOut} désabonné(s) ignoré(s)`}.
        </p>
      )}

      {mailingLog.length > 0 && (
        <details style={{ marginTop: 24 }}>
          <summary>Historique des envois ({mailingLog.length})</summary>
          <table className="data-table">
            <thead>
              <tr>
                <th>Nom</th>
                <th>Prénom</th>
                <th>E-mail</th>
                <th>Statut</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              {mailingLog.map((log) => (
                <tr key={log.id}>
                  <td>{log.nom ?? "—"}</td>
                  <td>{log.prenom ? formatPrenom(log.prenom) : "—"}</td>
                  <td>{log.email}</td>
                  <td>{log.status === "SENT" ? "Envoyé" : `Échec${log.error ? ` (${log.error})` : ""}`}</td>
                  <td>{new Date(log.sentAt).toLocaleString("fr-FR")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}

      {preview && (
        <div className="modal-overlay" onClick={() => setPreview(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="toolbar">
              <h3>Aperçu de l'e-mail</h3>
              <button type="button" className="secondary" onClick={() => setPreview(null)}>
                Fermer
              </button>
            </div>
            <p className="hint">
              À : {preview.data.to ?? "—"} <br />
              Sujet : {preview.data.subject}
            </p>
            <div className="email-preview" dangerouslySetInnerHTML={{ __html: preview.data.html }} />
          </div>
        </div>
      )}
    </div>
  );
}
