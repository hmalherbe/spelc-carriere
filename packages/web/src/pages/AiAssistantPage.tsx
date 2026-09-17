import { useEffect, useState } from "react";
import { api, type AiAssistantAnswer } from "../api.js";

export function AiAssistantPage() {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState<AiAssistantAnswer | null>(null);
  const [showSql, setShowSql] = useState(false);

  useEffect(() => {
    api
      .aiAssistantSuggestions()
      .then((r) => setSuggestions(r.questions))
      .catch(() => {});
  }, []);

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim()) return;
    setAsking(true);
    setError(null);
    setAnswer(null);
    try {
      setAnswer(await api.askAiAssistant(question.trim()));
    } catch (err) {
      setError(String(err));
    } finally {
      setAsking(false);
    }
  }

  const columns = answer && answer.rows.length > 0 ? Object.keys(answer.rows[0]) : [];

  return (
    <div className="import-page">
      <p className="hint">
        Posez une question en langage naturel sur les données (enseignants, campagnes, adhérents, mailings...).
        L'assistant s'appuie sur Mistral (clé API à renseigner dans Paramètres) pour interroger la base en lecture
        seule.
      </p>

      <section className="card">
        <h2>Questions possibles</h2>
        <div className="row-actions" style={{ flexWrap: "wrap" }}>
          {suggestions.map((q) => (
            <button key={q} type="button" className="secondary" onClick={() => setQuestion(q)}>
              {q}
            </button>
          ))}
        </div>
      </section>

      <section className="card">
        <form className="inline-form" onSubmit={ask}>
          <label style={{ flex: "1 1 100%" }}>
            Votre question
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              rows={3}
              style={{ width: "100%", minHeight: 70, resize: "vertical", fontFamily: "inherit" }}
              placeholder="Ex : combien d'enseignants sont promus cette campagne ?"
            />
          </label>
          <button type="submit" disabled={asking || !question.trim()}>
            {asking ? "Interrogation..." : "Poser la question"}
          </button>
        </form>
        {error && <p className="error-text">{error}</p>}
      </section>

      {answer && (
        <section className="card">
          <h2>Réponse</h2>
          <p>{answer.summary}</p>

          <details open={showSql} onToggle={(e) => setShowSql((e.target as HTMLDetailsElement).open)}>
            <summary>Voir la requête SQL générée ({answer.rowCount} ligne(s))</summary>
            <pre className="rule-formula">{answer.sql}</pre>
          </details>

          {answer.rows.length > 0 && (
            <div style={{ overflowX: "auto", marginTop: 12 }}>
              <table className="data-table">
                <thead>
                  <tr>
                    {columns.map((c) => (
                      <th key={c}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {answer.rows.map((row, i) => (
                    <tr key={i}>
                      {columns.map((c) => (
                        <td key={c}>{formatCell(row[c])}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "oui" : "non";
  return String(value);
}
