import { useEffect, useMemo, useState } from "react";
import {
  api,
  downloadBlob,
  type BrevoSettings,
  type Campagne,
  type MailingPreview,
  type MailingRecipient,
  type MailingSendResult,
  type MailingTemplate,
} from "../api.js";
import { useAuth } from "../AuthContext.js";
import { formatPrenom, formatEchelonLabel } from "../format.js";

function euros(n: number): string {
  return `${n >= 0 ? "+" : ""}${n} €`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("fr-FR");
}

/** Numeric-aware échelon ordering — échelon is a free-form string ("06", "6", "A1"...); lettered
 * échelons (hors-classe/classe exceptionnelle) sort after every numeric one. Same convention as
 * DashboardPage's own échelon filter. */
function echelonSortValue(echelon: string): number {
  const n = Number(echelon);
  return Number.isFinite(n) ? n : 1000 + echelon.charCodeAt(0);
}

/** Même règle que la colonne "Éligibilité BA" de DashboardPage (voir baCell() là-bas) — reprise ici
 * à l'identique, sur `echelonDepart` (équivalent de `echelonActuel` côté Dashboard : l'échelon de
 * départ avant la promotion de cette campagne). */
function baCell(r: MailingRecipient): { label: string; className: string } {
  if (r.baStatus === null) return { label: "—", className: "" };
  const atDepart = r.baEchelonDepart != null && Number(r.echelonDepart) === r.baEchelonDepart;
  const dep = atDepart ? ` (départ éch. ${r.baEchelonDepart})` : "";
  if (r.baStatus === "hors_fenetre") return { label: `BA hors fenêtre d'éligibilité${dep}`, className: "badge badge-indetermine" };
  if (r.baStatus === "promu") return { label: `Promu BA${dep}`, className: "badge badge-promu_estime" };
  return { label: `Éligible à la BA - non promu${dep}`, className: "badge badge-non_promu_estime" };
}

export function MailingPage() {
  const { user } = useAuth();
  const canSend = user?.role === "ADMIN" || user?.role === "GESTIONNAIRE";

  const [campagnes, setCampagnes] = useState<Campagne[]>([]);
  const [campagneId, setCampagneId] = useState<string | null>(null);
  const [recipients, setRecipients] = useState<MailingRecipient[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ teacherId: string; data: MailingPreview } | null>(null);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<MailingSendResult | null>(null);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const [editingEmailId, setEditingEmailId] = useState<string | null>(null);
  const [emailDraft, setEmailDraft] = useState("");
  const [savingEmail, setSavingEmail] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [savingCiviliteId, setSavingCiviliteId] = useState<string | null>(null);
  const [civiliteError, setCiviliteError] = useState<string | null>(null);
  const [brevoSettings, setBrevoSettings] = useState<BrevoSettings | null>(null);
  const [template, setTemplate] = useState<MailingTemplate>("generique");
  const [civiliteFilter, setCiviliteFilter] = useState<"" | "VIDE" | "M" | "Mme">("");
  const [gradeFilter, setGradeFilter] = useState<string>("all");
  const [echelonFilter, setEchelonFilter] = useState<string>("all");
  const [emailFilter, setEmailFilter] = useState<"" | "VIDE" | "RENSEIGNE">("");

  const selectedCampagne = useMemo(() => campagnes.find((c) => c.id === campagneId) ?? null, [campagnes, campagneId]);
  const ccmaModelAvailable = selectedCampagne?.type === "CCMA";

  // Options des filtres Grade/Échelon — sur `recipients` (pas `visibleRecipients`) pour que la
  // liste déroulante ne rétrécisse pas au fur et à mesure qu'on combine plusieurs filtres, comme
  // pour le filtre grade/échelon de DashboardPage. Échelon = échelon de départ (celui affiché en
  // premier dans la colonne "Échelon" : "départ → suivant").
  const grades = useMemo(() => Array.from(new Set(recipients.map((r) => r.grade))).sort(), [recipients]);
  const echelons = useMemo(
    () => Array.from(new Set(recipients.map((r) => r.echelonDepart))).sort((a, b) => echelonSortValue(a) - echelonSortValue(b)),
    [recipients],
  );

  // Filtre sur la civilité telle qu'affichée (estimée ou corrigée, peu importe) — "Vide" retrouve
  // les destinataires dont on n'a aucune civilité du tout (ni déclarée, ni devinée), typiquement à
  // corriger à la main. Affichage uniquement — ne touche pas à `selected` : la case à cocher d'une
  // ligne masquée par le filtre garde son état, exactement comme les filtres de DashboardPage.
  const visibleRecipients = useMemo(() => {
    return recipients.filter((r) => {
      if (civiliteFilter === "VIDE" && r.civilite != null) return false;
      if (civiliteFilter === "M" || civiliteFilter === "Mme") {
        if (r.civilite !== civiliteFilter) return false;
      }
      if (gradeFilter !== "all" && r.grade !== gradeFilter) return false;
      if (echelonFilter !== "all" && r.echelonDepart !== echelonFilter) return false;
      if (emailFilter === "VIDE" && r.email) return false;
      if (emailFilter === "RENSEIGNE" && !r.email) return false;
      return true;
    });
  }, [recipients, civiliteFilter, gradeFilter, echelonFilter, emailFilter]);

  const missingEmail = useMemo(() => visibleRecipients.filter((r) => !r.email), [visibleRecipients]);
  const missingEmailAllSelected = missingEmail.length > 0 && missingEmail.every((r) => selected.has(r.teacherId));

  useEffect(() => {
    api.campagnes().then((c) => {
      setCampagnes(c);
      if (c.length > 0) setCampagneId(c[0].id);
      else setLoading(false);
    });
    api.brevoSettings().then(setBrevoSettings).catch(() => undefined);
  }, []);

  function refresh(id: string) {
    setLoading(true);
    setError(null);
    api
      .mailingEligible(id)
      .then((list) => {
        setRecipients(list);
        setSelected(new Set(list.filter((r) => r.lastStatus !== "SENT").map((r) => r.teacherId)));
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (campagneId) refresh(campagneId);
    // Le modèle CCMA (reconstruit à partir du vrai courrier du syndicat) est le bon choix par
    // défaut dès qu'il est disponible — sans ça, rebasculer silencieusement sur "Modèle générique"
    // à chaque changement de campagne faisait repartir une campagne CCMA sans aucun contenu lié à
    // la BA (bonification d'ancienneté) tant que l'admin ne re-sélectionnait pas le bon modèle à la
    // main, un piège facile à manquer avant un envoi réel.
    setTemplate(selectedCampagne?.type === "CCMA" ? "ccma_avancement" : "generique");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campagneId]);

  function toggle(teacherId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(teacherId)) next.delete(teacherId);
      else next.add(teacherId);
      return next;
    });
  }

  /** Bulk-toggles every currently visible recipient with no known e-mail address — their own
   * checkbox stays disabled (nothing to send them by e-mail), but they're still valid "Générer
   * PDF" targets (a paper fallback for someone unreachable by e-mail), so this is the only way to
   * select exactly that group at once rather than one row at a time. */
  function toggleMissingEmail() {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const r of missingEmail) {
        if (missingEmailAllSelected) next.delete(r.teacherId);
        else next.add(r.teacherId);
      }
      return next;
    });
  }

  async function openPreview(teacherId: string) {
    if (!campagneId) return;
    try {
      const data = await api.mailingPreview(campagneId, teacherId, template);
      setPreview({ teacherId, data });
    } catch (e) {
      setError(String(e));
    }
  }

  function startEditEmail(r: MailingRecipient) {
    setEditingEmailId(r.teacherId);
    setEmailDraft(r.email ?? "");
    setEmailError(null);
  }

  async function saveEmail(teacherId: string) {
    if (!campagneId) return;
    setSavingEmail(true);
    setEmailError(null);
    try {
      await api.updateMailingEmail(teacherId, emailDraft);
      setEditingEmailId(null);
      refresh(campagneId);
    } catch (e) {
      setEmailError(String(e));
    } finally {
      setSavingEmail(false);
    }
  }

  async function saveCivilite(teacherId: string, value: string) {
    if (!campagneId) return;
    const civilite = value === "M" || value === "Mme" ? value : null;
    setSavingCiviliteId(teacherId);
    setCiviliteError(null);
    try {
      await api.updateMailingCivilite(teacherId, civilite);
      refresh(campagneId);
    } catch (e) {
      setCiviliteError(String(e));
    } finally {
      setSavingCiviliteId(null);
    }
  }

  async function send() {
    if (!campagneId || selected.size === 0) return;
    const count = selected.size;
    const confirmMessage = brevoSettings?.testMode
      ? `Mode test actif : les ${count} e-mail(s) partiront tous vers ${brevoSettings.testEmail} au lieu des vrais destinataires` +
        (brevoSettings.testMaxSends != null ? ` (limité à ${brevoSettings.testMaxSends} envoi(s))` : "") +
        ". Continuer ?"
      : `Envoyer un e-mail à ${count} adhérent(s) via Brevo ? Cette action envoie de vrais e-mails et ne peut pas être annulée.`;
    if (!window.confirm(confirmMessage)) {
      return;
    }
    setSending(true);
    setError(null);
    setSendResult(null);
    try {
      const result = await api.mailingSend(campagneId, Array.from(selected), template);
      setSendResult(result);
      refresh(campagneId);
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
      const blob = await api.mailingPdf(campagneId, Array.from(selected), template);
      downloadBlob(blob, `mailing-${selectedCampagne?.anneeScolaire ?? campagneId}.pdf`);
    } catch (e) {
      setPdfError(String(e));
    } finally {
      setGeneratingPdf(false);
    }
  }

  if (error && recipients.length === 0) return <p className="error-text">{error}</p>;

  return (
    <div>
      <div className="toolbar">
        <h2>Mailing — notification des changements d'échelon</h2>
        {campagnes.length > 0 && (
          <select value={campagneId ?? ""} onChange={(e) => setCampagneId(e.target.value)}>
            {campagnes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.type ?? "?"} {c.anneeScolaire}
              </option>
            ))}
          </select>
        )}
        {ccmaModelAvailable && (
          <select value={template} onChange={(e) => setTemplate(e.target.value as MailingTemplate)}>
            <option value="generique">Modèle générique</option>
            <option value="ccma_avancement">Modèle CCMA (avancement d'échelon)</option>
          </select>
        )}
      </div>
      <p className="hint">
        Tout enseignant ayant un résultat de promotion pour cette campagne apparaît ici. Un adhérent (rapprochement
        confirmé) est notifié à son adresse personnelle ; un non-adhérent, à son adresse académique si elle est connue
        (import "Emails académiques" de la page Import) — sinon aucun envoi n'est possible pour lui. La civilité d'un
        adhérent est celle déclarée dans l'import Spelc ; celle d'un non-adhérent est estimée à partir de son prénom
        (marquée "estimé") et peut être absente si le prénom est ambigu ou inconnu. Le logo et l'« Entête haut droit »
        de Paramètres apparaissent en haut de chaque mailing ; les élus de la commission de cette campagne (CCMA ou CCMI —
        page Élus CCMA/CCMI, page Import pour la corriger), un lien de désabonnement pour les non-adhérents et les
        réseaux sociaux de Paramètres apparaissent en bas. L'envoi se fait via Brevo.
      </p>
      {template === "ccma_avancement" && (
        <p className="hint">
          Modèle reconstruit à partir du courrier CCMA du Spelc (report d'ancienneté, bonification, comparaison au
          dernier promu du même grade/échelon...) — vérifiez l'aperçu de quelques destinataires avant l'envoi.
        </p>
      )}
      {selectedCampagne && !selectedCampagne.type && (
        <p className="hint error-text">
          Cette campagne n'a pas de commission (CCMA/CCMI) définie — aucun élu n'apparaîtra dans les mailings envoyés.
          À corriger sur la page Import.
        </p>
      )}

      {error && <p className="error-text">{error}</p>}

      {brevoSettings?.testMode && (
        <p className="import-result">
          <strong>Mode test actif</strong> — tout envoi redirige vers {brevoSettings.testEmail}
          {brevoSettings.testMaxSends != null && <> (limité à {brevoSettings.testMaxSends} e-mail(s) par envoi)</>}, sans
          jamais atteindre les vrais destinataires. À désactiver dans Paramètres pour une vraie campagne.
        </p>
      )}

      {canSend && (
        <div className="toolbar">
          <span className="hint">{selected.size} sélectionné(s)</span>
          <button onClick={send} disabled={selected.size === 0 || sending}>
            {sending ? "Envoi en cours..." : "Envoyer"}
          </button>
          <button type="button" className="secondary" onClick={generatePdf} disabled={selected.size === 0 || generatingPdf}>
            {generatingPdf ? "Génération en cours..." : "Générer PDF"}
          </button>
          {pdfError && <span className="error-text">{pdfError}</span>}
        </div>
      )}

      {civiliteError && <p className="error-text">{civiliteError}</p>}

      {sendResult && (
        <div className="import-result">
          <p>
            <strong>{sendResult.sent}</strong> envoyé(s), <strong>{sendResult.failed}</strong> échec(s).
            {sendResult.testMode && " (mode test — aucun vrai destinataire atteint, rien n'a été marqué comme envoyé)"}
          </p>
          {sendResult.failed > 0 && (
            <details>
              <summary>Détail des échecs</summary>
              <ul>
                {sendResult.results
                  .filter((r) => r.status === "FAILED")
                  .map((r) => (
                    <li key={r.teacherId}>
                      {r.nom} {formatPrenom(r.prenom)} — {r.error}
                    </li>
                  ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {recipients.length > 0 && (
        <div className="toolbar">
          <label>
            Filtrer par civilité
            <select value={civiliteFilter} onChange={(e) => setCiviliteFilter(e.target.value as typeof civiliteFilter)}>
              <option value="">Toutes</option>
              <option value="VIDE">Vide</option>
              <option value="M">M</option>
              <option value="Mme">Mme</option>
            </select>
          </label>
          <label>
            Grade
            <select value={gradeFilter} onChange={(e) => setGradeFilter(e.target.value)}>
              <option value="all">Tous</option>
              {grades.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </label>
          <label>
            Échelon
            <select value={echelonFilter} onChange={(e) => setEchelonFilter(e.target.value)}>
              <option value="all">Tous</option>
              {echelons.map((e) => (
                <option key={e} value={e}>
                  {formatEchelonLabel(e)}
                </option>
              ))}
            </select>
          </label>
          <label>
            E-mail
            <select value={emailFilter} onChange={(e) => setEmailFilter(e.target.value as typeof emailFilter)}>
              <option value="">Tous</option>
              <option value="VIDE">Vide</option>
              <option value="RENSEIGNE">Renseigné</option>
            </select>
          </label>
        </div>
      )}

      {loading ? (
        <p>Chargement...</p>
      ) : recipients.length === 0 ? (
        <p className="hint">Aucun destinataire éligible pour cette campagne.</p>
      ) : visibleRecipients.length === 0 ? (
        <p className="hint">Aucun destinataire ne correspond à ce filtre.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              {canSend && <th></th>}
              <th>Civilité</th>
              <th>Nom</th>
              <th>Prénom</th>
              <th>Adhérent</th>
              <th>Grade</th>
              <th>Échelon</th>
              <th>Éligibilité BA</th>
              <th>Gain net</th>
              <th>
                {canSend && (
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2 }}>
                    <input
                      type="checkbox"
                      checked={missingEmailAllSelected}
                      disabled={missingEmail.length === 0}
                      onChange={toggleMissingEmail}
                      title="Sélectionner les destinataires sans adresse e-mail (ex. pour « Générer PDF »)"
                    />
                  </div>
                )}
                E-mail
              </th>
              <th>Statut</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visibleRecipients.map((r) => (
              <tr key={r.teacherId}>
                {canSend && (
                  <td>
                    <input type="checkbox" checked={selected.has(r.teacherId)} disabled={!r.email} onChange={() => toggle(r.teacherId)} />
                  </td>
                )}
                <td>
                  {canSend ? (
                    <div className="row-actions">
                      <select
                        value={r.civilite === "M" || r.civilite === "Mme" ? r.civilite : ""}
                        disabled={savingCiviliteId === r.teacherId}
                        onChange={(e) => saveCivilite(r.teacherId, e.target.value)}
                      >
                        <option value="">(auto)</option>
                        <option value="M">M</option>
                        <option value="Mme">Mme</option>
                      </select>
                      {r.civiliteEstimee && <span className="hint">estimé</span>}
                    </div>
                  ) : (
                    <>
                      {r.civilite ?? <span className="hint">—</span>}
                      {r.civiliteEstimee && <span className="hint"> (estimé)</span>}
                    </>
                  )}
                </td>
                <td>{r.nom}</td>
                <td>{formatPrenom(r.prenom)}</td>
                <td>
                  <span className={`badge ${r.isAdherent ? "badge-auto_confirmed" : "badge-non_adherent"}`}>
                    {r.isAdherent ? "Adhérent" : "Non adhérent"}
                  </span>
                </td>
                <td>{r.grade}</td>
                <td>
                  {formatEchelonLabel(r.echelonDepart)} → {formatEchelonLabel(r.echelonSuivant)}
                </td>
                <td>
                  {(() => {
                    const ba = baCell(r);
                    return ba.className ? <span className={ba.className}>{ba.label}</span> : ba.label;
                  })()}
                </td>
                <td className={r.gainSalaireNet > 0 ? "gain-positive" : ""}>{euros(r.gainSalaireNet)}</td>
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
                      {r.email ?? <span className="error-text">aucune adresse</span>}
                      {canSend && (
                        <button type="button" className="secondary" onClick={() => startEditEmail(r)}>
                          {r.email ? "Modifier" : "Ajouter"}
                        </button>
                      )}
                    </div>
                  )}
                </td>
                <td>
                  {r.lastStatus ? (
                    <span className={`badge ${r.lastStatus === "SENT" ? "badge-auto_confirmed" : "badge-non_promu_estime"}`}>
                      {r.lastStatus === "SENT" ? `Envoyé le ${formatDate(r.lastSentAt)}` : "Échec"}
                    </span>
                  ) : (
                    <span className="hint">—</span>
                  )}
                </td>
                <td>
                  <button type="button" className="secondary" onClick={() => openPreview(r.teacherId)}>
                    Aperçu
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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
