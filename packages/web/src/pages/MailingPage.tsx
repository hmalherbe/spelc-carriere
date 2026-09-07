import { useEffect, useState } from "react";
import { api, type Campagne, type MailingPreview, type MailingRecipient, type MailingSendResult } from "../api.js";
import { useAuth } from "../AuthContext.js";

function euros(n: number): string {
  return `${n >= 0 ? "+" : ""}${n} €`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("fr-FR");
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

  useEffect(() => {
    api.campagnes().then((c) => {
      setCampagnes(c);
      if (c.length > 0) setCampagneId(c[0].id);
      else setLoading(false);
    });
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
  }, [campagneId]);

  function toggle(teacherId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(teacherId)) next.delete(teacherId);
      else next.add(teacherId);
      return next;
    });
  }

  async function openPreview(teacherId: string) {
    if (!campagneId) return;
    const data = await api.mailingPreview(campagneId, teacherId);
    setPreview({ teacherId, data });
  }

  async function send() {
    if (!campagneId || selected.size === 0) return;
    const count = selected.size;
    if (!window.confirm(`Envoyer un e-mail à ${count} adhérent(s) via Brevo ? Cette action envoie de vrais e-mails et ne peut pas être annulée.`)) {
      return;
    }
    setSending(true);
    setError(null);
    setSendResult(null);
    try {
      const result = await api.mailingSend(campagneId, Array.from(selected));
      setSendResult(result);
      refresh(campagneId);
    } catch (e) {
      setError(String(e));
    } finally {
      setSending(false);
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
                Campagne {c.anneeScolaire}
              </option>
            ))}
          </select>
        )}
      </div>
      <p className="hint">
        Seuls les adhérents dont le rapprochement avec un enseignant a été confirmé (automatiquement ou manuellement) et pour
        qui une adresse e-mail est connue apparaissent ici. L'envoi se fait via Brevo.
      </p>

      {error && <p className="error-text">{error}</p>}

      {canSend && (
        <div className="toolbar">
          <span className="hint">{selected.size} sélectionné(s)</span>
          <button onClick={send} disabled={selected.size === 0 || sending}>
            {sending ? "Envoi en cours..." : "Envoyer"}
          </button>
        </div>
      )}

      {sendResult && (
        <div className="import-result">
          <p>
            <strong>{sendResult.sent}</strong> envoyé(s), <strong>{sendResult.failed}</strong> échec(s).
          </p>
          {sendResult.failed > 0 && (
            <details>
              <summary>Détail des échecs</summary>
              <ul>
                {sendResult.results
                  .filter((r) => r.status === "FAILED")
                  .map((r) => (
                    <li key={r.teacherId}>
                      {r.nom} {r.prenom} — {r.error}
                    </li>
                  ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {loading ? (
        <p>Chargement...</p>
      ) : recipients.length === 0 ? (
        <p className="hint">Aucun destinataire éligible pour cette campagne.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              {canSend && <th></th>}
              <th>Nom</th>
              <th>Prénom</th>
              <th>Grade</th>
              <th>Échelon</th>
              <th>Gain net</th>
              <th>E-mail</th>
              <th>Statut</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {recipients.map((r) => (
              <tr key={r.teacherId}>
                {canSend && (
                  <td>
                    <input type="checkbox" checked={selected.has(r.teacherId)} disabled={!r.email} onChange={() => toggle(r.teacherId)} />
                  </td>
                )}
                <td>{r.nom}</td>
                <td>{r.prenom}</td>
                <td>{r.grade}</td>
                <td>
                  {r.echelonDepart} → {r.echelonSuivant}
                </td>
                <td className={r.gainSalaireNet > 0 ? "gain-positive" : ""}>{euros(r.gainSalaireNet)}</td>
                <td>{r.email ?? <span className="error-text">aucune adresse</span>}</td>
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
