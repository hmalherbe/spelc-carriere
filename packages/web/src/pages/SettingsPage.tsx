import { useEffect, useState } from "react";
import { api, type AdelSettings, type BrevoSettings } from "../api.js";
import { useAuth } from "../AuthContext.js";

export function SettingsPage() {
  const { user } = useAuth();
  const canEdit = user?.role === "ADMIN";

  const [settings, setSettings] = useState<AdelSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [loginUrl, setLoginUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [spelcName, setSpelcName] = useState("azur");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function refresh() {
    setLoading(true);
    api
      .adelSettings()
      .then((s) => {
        setSettings(s);
        setLoginUrl(s.loginUrl ?? "");
        setUsername(s.username ?? "");
        setSpelcName(s.spelcName);
        setPassword("");
      })
      .catch((e) => setLoadError(String(e)))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const updated = await api.updateAdelSettings({ loginUrl, username, spelcName, ...(password ? { password } : {}) });
      setSettings(updated);
      setPassword("");
      setSaved(true);
    } catch (e) {
      setSaveError(String(e));
    } finally {
      setSaving(false);
    }
  }

  if (loadError) return <p className="error-text">{loadError}</p>;
  if (loading || !settings) return <p>Chargement...</p>;

  return (
    <div className="import-page">
      <section className="card">
        <h2>Connexion ADEL</h2>
        <p className="hint">
          Identifiants utilisés par la synchronisation automatique des adhérents (écran Import → Synchronisation ADEL).
          Enregistrés ici, ils prennent le pas sur les variables d'environnement ADEL_URL/ADEL_USERNAME/ADEL_PASSWORD du
          serveur — plus besoin de redéployer pour changer un mot de passe.
          {settings.updatedAt && <> Dernière modification le {new Date(settings.updatedAt).toLocaleString("fr-FR")}.</>}
        </p>

        {!canEdit ? (
          <p className="hint">
            {settings.hasPassword ? "Un mot de passe est configuré." : "Aucun mot de passe n'est configuré."} Seul un
            administrateur peut modifier ces identifiants.
          </p>
        ) : (
          <form className="inline-form" onSubmit={submit}>
            <label>
              URL de connexion
              <input
                required
                type="url"
                value={loginUrl}
                onChange={(e) => setLoginUrl(e.target.value)}
                placeholder="https://adel.exemple.fr/connexion"
              />
            </label>
            <label>
              Identifiant
              <input required type="text" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
            </label>
            <label>
              Mot de passe
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={settings.hasPassword ? "(inchangé — laisser vide pour conserver)" : ""}
                autoComplete="new-password"
              />
            </label>
            <label>
              Nom Spelc (ADEL)
              <input required type="text" value={spelcName} onChange={(e) => setSpelcName(e.target.value)} />
            </label>
            <button type="submit" disabled={saving}>
              {saving ? "Enregistrement..." : "Enregistrer"}
            </button>
            {saved && <span className="hint"> Enregistré.</span>}
          </form>
        )}
        {saveError && <p className="error-text">{saveError}</p>}
      </section>

      <BrevoSettingsCard canEdit={canEdit} />
    </div>
  );
}

function BrevoSettingsCard({ canEdit }: { canEdit: boolean }) {
  const [settings, setSettings] = useState<BrevoSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [senderEmail, setSenderEmail] = useState("");
  const [senderName, setSenderName] = useState("Spelc");
  const [apiKey, setApiKey] = useState("");
  const [testMode, setTestMode] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  const [testMaxSends, setTestMaxSends] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function refresh() {
    setLoading(true);
    api
      .brevoSettings()
      .then((s) => {
        setSettings(s);
        setSenderEmail(s.senderEmail ?? "");
        setSenderName(s.senderName);
        setTestMode(s.testMode);
        setTestEmail(s.testEmail ?? "");
        setTestMaxSends(s.testMaxSends != null ? String(s.testMaxSends) : "");
        setApiKey("");
      })
      .catch((e) => setLoadError(String(e)))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const updated = await api.updateBrevoSettings({
        senderEmail,
        senderName,
        testMode,
        ...(apiKey ? { apiKey } : {}),
        ...(testEmail ? { testEmail } : {}),
        ...(testMaxSends ? { testMaxSends: Number(testMaxSends) } : {}),
      });
      setSettings(updated);
      setApiKey("");
      setSaved(true);
    } catch (e) {
      setSaveError(String(e));
    } finally {
      setSaving(false);
    }
  }

  if (loadError) return <p className="error-text">{loadError}</p>;
  if (loading || !settings) return <p>Chargement...</p>;

  return (
    <section className="card">
      <h2>Envoi de mail (Brevo)</h2>
      <p className="hint">
        Clé API utilisée par l'écran Mailing pour notifier les enseignants de leur changement d'échelon. Enregistrée
        ici, elle prend le pas sur les variables d'environnement BREVO_API_KEY/BREVO_SENDER_EMAIL/BREVO_SENDER_NAME du
        serveur — plus besoin de redéployer pour la changer.
        {settings.updatedAt && <> Dernière modification le {new Date(settings.updatedAt).toLocaleString("fr-FR")}.</>}
      </p>

      {!canEdit ? (
        <p className="hint">
          {settings.hasApiKey ? "Une clé API est configurée." : "Aucune clé API n'est configurée."} Seul un
          administrateur peut modifier ces réglages.
        </p>
      ) : (
        <form className="inline-form" onSubmit={submit}>
          <label>
            Clé API Brevo
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={settings.hasApiKey ? "(inchangée — laisser vide pour conserver)" : "xkeysib-..."}
              autoComplete="off"
            />
          </label>
          <label>
            Adresse expéditrice
            <input required type="email" value={senderEmail} onChange={(e) => setSenderEmail(e.target.value)} />
          </label>
          <label>
            Nom expéditeur
            <input required type="text" value={senderName} onChange={(e) => setSenderName(e.target.value)} />
          </label>
          <label className="checkbox-label">
            <input type="checkbox" checked={testMode} onChange={(e) => setTestMode(e.target.checked)} />
            Mode test — redirige tous les envois vers l'adresse de test ci-dessous, sans jamais atteindre les vrais
            destinataires
          </label>
          <label>
            Adresse de test
            <input
              type="email"
              required={testMode}
              value={testEmail}
              onChange={(e) => setTestEmail(e.target.value)}
              placeholder="test@exemple.fr"
            />
          </label>
          <label>
            Nombre maximal d'e-mails par envoi en mode test
            <input
              type="number"
              min={1}
              value={testMaxSends}
              onChange={(e) => setTestMaxSends(e.target.value)}
              placeholder="illimité"
            />
          </label>
          <button type="submit" disabled={saving}>
            {saving ? "Enregistrement..." : "Enregistrer"}
          </button>
          {saved && <span className="hint"> Enregistré.</span>}
        </form>
      )}
      {saveError && <p className="error-text">{saveError}</p>}
    </section>
  );
}
