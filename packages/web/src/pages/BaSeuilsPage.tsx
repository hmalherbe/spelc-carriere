import { useEffect, useState } from "react";
import { api, type BaSeuil, type Campagne } from "../api.js";
import { useAuth } from "../AuthContext.js";

export function BaSeuilsPage() {
  const { user } = useAuth();
  const [campagnes, setCampagnes] = useState<Campagne[]>([]);
  const [campagneId, setCampagneId] = useState<string | null>(null);
  const [seuils, setSeuils] = useState<BaSeuil[]>([]);
  const [editing, setEditing] = useState<Record<string, Partial<BaSeuil>>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const canEdit = user?.role === "ADMIN";

  useEffect(() => {
    api.campagnes().then((c) => {
      setCampagnes(c);
      if (c.length > 0) setCampagneId(c[0].id);
      else setLoading(false);
    });
  }, []);

  function refresh(id: string) {
    setLoading(true);
    api
      .baSeuils(id)
      .then(setSeuils)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (campagneId) refresh(campagneId);
  }, [campagneId]);

  async function save(seuil: BaSeuil) {
    const changes = editing[seuil.id];
    if (!changes) return;
    await api.updateBaSeuil(seuil.id, changes);
    setEditing((prev) => {
      const next = { ...prev };
      delete next[seuil.id];
      return next;
    });
    if (campagneId) refresh(campagneId);
  }

  async function toggleLock(seuil: BaSeuil) {
    await api.updateBaSeuil(seuil.id, { locked: !seuil.locked });
    if (campagneId) refresh(campagneId);
  }

  if (error) return <p className="error-text">{error}</p>;

  return (
    <div>
      <div className="toolbar">
        <h2>Seuils de promotion "au choix" (bonification d'ancienneté, échelons 6/8)</h2>
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
        Ces seuils sont <strong>estimés automatiquement</strong> à partir des résultats déjà connus de la campagne — ce n'est pas la
        règle officielle du rectorat. Une fois le seuil réel confirmé, un admin peut le corriger et le verrouiller pour qu'il cesse
        d'évoluer avec les nouveaux imports.
      </p>
      {loading ? (
        <p>Chargement...</p>
      ) : seuils.length === 0 ? (
        <p className="hint">Aucun seuil calculé pour cette campagne (pas encore de promotion "au choix" confirmée aux échelons 6/8).</p>
      ) : (
      <table className="data-table">
        <thead>
          <tr>
            <th>Grade</th>
            <th>Échelon</th>
            <th>Nb promus (BA)</th>
            <th>Barème min.</th>
            <th>Anc. grade min.</th>
            <th>Anc. échelon min.</th>
            <th>État</th>
            {canEdit && <th>Actions</th>}
          </tr>
        </thead>
        <tbody>
          {seuils.map((s) => {
            const draft = editing[s.id] ?? {};
            return (
              <tr key={s.id}>
                <td>{s.grade}</td>
                <td>{s.echelonDepart}</td>
                <td>{s.nombrePromusBa}</td>
                <td>
                  {canEdit && s.locked ? (
                    <input
                      type="number"
                      min={0}
                      max={4}
                      value={draft.minBareme ?? s.minBareme}
                      onChange={(e) => setEditing((p) => ({ ...p, [s.id]: { ...p[s.id], minBareme: Number(e.target.value) } }))}
                    />
                  ) : (
                    s.minBareme
                  )}
                </td>
                <td>{s.minAncienneteGrade}</td>
                <td>{s.minAncienneteEchelon}</td>
                <td>
                  <span className={`badge ${s.locked ? "badge-locked" : "badge-estimated"}`}>
                    {s.locked ? "Verrouillé" : "Estimé automatiquement"}
                  </span>
                </td>
                {canEdit && (
                  <td>
                    <div className="row-actions">
                      <button onClick={() => toggleLock(s)}>{s.locked ? "Déverrouiller" : "Verrouiller"}</button>
                      {s.locked && editing[s.id] && <button onClick={() => save(s)}>Enregistrer</button>}
                    </div>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      )}
    </div>
  );
}
