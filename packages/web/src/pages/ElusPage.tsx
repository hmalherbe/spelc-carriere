import { useEffect, useState } from "react";
import { api, type Elu, type EluInput } from "../api.js";
import { useAuth } from "../AuthContext.js";

const ROLE_LABEL: Record<Elu["role"], string> = { TITULAIRE: "Titulaire", SUPPLEANT: "Suppléant(e)" };

const EMPTY_FORM: EluInput = { commission: "CCMA", role: "TITULAIRE", prenom: "", nom: "", telephone: "", email: "" };

export function ElusPage() {
  const { user } = useAuth();
  const canEdit = user?.role === "ADMIN" || user?.role === "GESTIONNAIRE";

  const [commission, setCommission] = useState<"CCMA" | "CCMI">("CCMA");
  const [elus, setElus] = useState<Elu[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState<EluInput>({ ...EMPTY_FORM, commission: "CCMA" });
  const [saving, setSaving] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EluInput | null>(null);

  function refresh() {
    setLoading(true);
    setError(null);
    api
      .elus(commission)
      .then(setElus)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    refresh();
    setForm((f) => ({ ...f, commission }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commission]);

  async function submitNew(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.createElu(form);
      setForm({ ...EMPTY_FORM, commission });
      refresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  function startEdit(elu: Elu) {
    setEditingId(elu.id);
    setEditForm({
      commission: elu.commission,
      role: elu.role,
      prenom: elu.prenom,
      nom: elu.nom,
      telephone: elu.telephone ?? "",
      email: elu.email ?? "",
    });
  }

  async function saveEdit(id: string) {
    if (!editForm) return;
    setSaving(true);
    setError(null);
    try {
      await api.updateElu(id, editForm);
      setEditingId(null);
      setEditForm(null);
      refresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Supprimer cet élu ?")) return;
    setError(null);
    try {
      await api.deleteElu(id);
      refresh();
    } catch (err) {
      setError(String(err));
    }
  }

  return (
    <div>
      <div className="toolbar">
        <h2>Élus CCMA/CCMI</h2>
        <select value={commission} onChange={(e) => setCommission(e.target.value as "CCMA" | "CCMI")}>
          <option value="CCMA">CCMA (second degré)</option>
          <option value="CCMI">CCMI (premier degré)</option>
        </select>
      </div>
      <p className="hint">
        Élus et suppléants affichés automatiquement en bas de chaque mailing de notification, selon la commission du
        destinataire (déduite de son grade).
      </p>

      {error && <p className="error-text">{error}</p>}

      {canEdit && (
        <form className="inline-form" onSubmit={submitNew}>
          <label>
            Rôle
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as EluInput["role"] })}>
              <option value="TITULAIRE">Titulaire</option>
              <option value="SUPPLEANT">Suppléant(e)</option>
            </select>
          </label>
          <label>
            Prénom
            <input required type="text" value={form.prenom} onChange={(e) => setForm({ ...form, prenom: e.target.value })} />
          </label>
          <label>
            Nom
            <input required type="text" value={form.nom} onChange={(e) => setForm({ ...form, nom: e.target.value })} />
          </label>
          <label>
            Téléphone
            <input type="tel" value={form.telephone} onChange={(e) => setForm({ ...form, telephone: e.target.value })} />
          </label>
          <label>
            E-mail
            <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </label>
          <button type="submit" disabled={saving}>
            {saving ? "Ajout..." : `Ajouter à ${commission}`}
          </button>
        </form>
      )}

      {loading ? (
        <p>Chargement...</p>
      ) : elus.length === 0 ? (
        <p className="hint">Aucun élu enregistré pour {commission}.</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Rôle</th>
              <th>Prénom</th>
              <th>Nom</th>
              <th>Téléphone</th>
              <th>E-mail</th>
              {canEdit && <th></th>}
            </tr>
          </thead>
          <tbody>
            {elus.map((elu) =>
              editingId === elu.id && editForm ? (
                <tr key={elu.id}>
                  <td>
                    <select value={editForm.role} onChange={(e) => setEditForm({ ...editForm, role: e.target.value as EluInput["role"] })}>
                      <option value="TITULAIRE">Titulaire</option>
                      <option value="SUPPLEANT">Suppléant(e)</option>
                    </select>
                  </td>
                  <td>
                    <input type="text" value={editForm.prenom} onChange={(e) => setEditForm({ ...editForm, prenom: e.target.value })} />
                  </td>
                  <td>
                    <input type="text" value={editForm.nom} onChange={(e) => setEditForm({ ...editForm, nom: e.target.value })} />
                  </td>
                  <td>
                    <input type="tel" value={editForm.telephone} onChange={(e) => setEditForm({ ...editForm, telephone: e.target.value })} />
                  </td>
                  <td>
                    <input type="email" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} />
                  </td>
                  <td>
                    <div className="row-actions">
                      <button type="button" onClick={() => saveEdit(elu.id)} disabled={saving}>
                        Enregistrer
                      </button>
                      <button type="button" className="secondary" onClick={() => setEditingId(null)} disabled={saving}>
                        Annuler
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                <tr key={elu.id}>
                  <td>{ROLE_LABEL[elu.role]}</td>
                  <td>{elu.prenom}</td>
                  <td>{elu.nom}</td>
                  <td>{elu.telephone ?? <span className="hint">—</span>}</td>
                  <td>{elu.email ?? <span className="hint">—</span>}</td>
                  {canEdit && (
                    <td>
                      <div className="row-actions">
                        <button type="button" className="secondary" onClick={() => startEdit(elu)}>
                          Modifier
                        </button>
                        <button type="button" className="secondary" onClick={() => remove(elu.id)}>
                          Supprimer
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ),
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
