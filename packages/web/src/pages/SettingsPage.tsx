import { useEffect, useState } from "react";
import { api, type AdelSettings, type BrevoSettings, type MailingBranding, type SocialLink } from "../api.js";
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
      <MailingBrandingCard canEdit={canEdit} />
      <SocialLinksCard canEdit={canEdit} />
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

function MailingBrandingCard({ canEdit }: { canEdit: boolean }) {
  const [branding, setBranding] = useState<MailingBranding | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [t1Text, setT1Text] = useState("");
  const [savingText, setSavingText] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function refresh() {
    setLoading(true);
    api
      .mailingBranding()
      .then((b) => {
        setBranding(b);
        setT1Text(b.t1Text ?? "");
      })
      .catch((e) => setLoadError(String(e)))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    refresh();
  }, []);

  async function submitText(e: React.FormEvent) {
    e.preventDefault();
    setSavingText(true);
    setSaveError(null);
    setSaved(false);
    try {
      setBranding(await api.updateMailingBrandingText(t1Text));
      setSaved(true);
    } catch (err) {
      setSaveError(String(err));
    } finally {
      setSavingText(false);
    }
  }

  async function onLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingLogo(true);
    setSaveError(null);
    try {
      setBranding(await api.uploadMailingLogo(file));
    } catch (err) {
      setSaveError(String(err));
    } finally {
      setUploadingLogo(false);
      e.target.value = "";
    }
  }

  async function removeLogo() {
    if (!window.confirm("Supprimer le logo des mailings ?")) return;
    setSaveError(null);
    try {
      setBranding(await api.deleteMailingLogo());
    } catch (err) {
      setSaveError(String(err));
    }
  }

  if (loadError) return <p className="error-text">{loadError}</p>;
  if (loading || !branding) return <p>Chargement...</p>;

  return (
    <section className="card">
      <h2>Image de marque des mailings</h2>
      <p className="hint">
        Logo affiché en haut à gauche et texte « t1 » affiché en haut à droite de chaque mailing CCMA/CCMI envoyé aux
        enseignants.
      </p>

      {!canEdit ? (
        <p className="hint">Seul un administrateur peut modifier ces réglages.</p>
      ) : (
        <>
          <div className="row-actions" style={{ marginTop: 12 }}>
            {branding.logoDataUrl ? (
              <img src={branding.logoDataUrl} alt="Logo actuel" style={{ maxHeight: 60, maxWidth: 220 }} />
            ) : (
              <span className="hint">Aucun logo configuré</span>
            )}
            <label className="secondary" style={{ cursor: "pointer", padding: "8px 14px", borderRadius: 6 }}>
              {uploadingLogo ? "Envoi..." : branding.logoDataUrl ? "Remplacer le logo" : "Ajouter un logo"}
              <input type="file" accept="image/*" onChange={onLogoChange} disabled={uploadingLogo} style={{ display: "none" }} />
            </label>
            {branding.logoDataUrl && (
              <button type="button" className="secondary" onClick={removeLogo}>
                Supprimer le logo
              </button>
            )}
          </div>

          <form className="inline-form" onSubmit={submitText}>
            <label style={{ flex: "1 1 100%" }}>
              Texte « t1 » (haut à droite)
              <textarea
                value={t1Text}
                onChange={(e) => setT1Text(e.target.value)}
                maxLength={500}
                rows={4}
                style={{ width: "100%", minHeight: 90, resize: "vertical", fontFamily: "inherit" }}
              />
            </label>
            <button type="submit" disabled={savingText}>
              {savingText ? "Enregistrement..." : "Enregistrer"}
            </button>
            {saved && <span className="hint"> Enregistré.</span>}
          </form>
        </>
      )}
      {saveError && <p className="error-text">{saveError}</p>}
    </section>
  );
}

function SocialLinksCard({ canEdit }: { canEdit: boolean }) {
  const [links, setLinks] = useState<SocialLink[]>([]);
  const [draft, setDraft] = useState<{ label: string; url: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function refresh() {
    setLoading(true);
    api
      .socialLinks()
      .then((l) => {
        setLinks(l);
        setDraft(l.map((x) => ({ label: x.label, url: x.url })));
      })
      .catch((e) => setLoadError(String(e)))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    refresh();
  }, []);

  function updateRow(i: number, field: "label" | "url", value: string) {
    setDraft((d) => d.map((row, idx) => (idx === i ? { ...row, [field]: value } : row)));
  }

  function addRow() {
    setDraft((d) => [...d, { label: "", url: "" }]);
  }

  function removeRow(i: number) {
    setDraft((d) => d.filter((_, idx) => idx !== i));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const cleaned = draft.filter((r) => r.label.trim() && r.url.trim());
      const updated = await api.updateSocialLinks(cleaned);
      setLinks(updated);
      setDraft(updated.map((x) => ({ label: x.label, url: x.url })));
      setSaved(true);
    } catch (err) {
      setSaveError(String(err));
    } finally {
      setSaving(false);
    }
  }

  if (loadError) return <p className="error-text">{loadError}</p>;
  if (loading) return <p>Chargement...</p>;

  return (
    <section className="card">
      <h2>Réseaux sociaux</h2>
      <p className="hint">
        Liens affichés à la fin de chaque mailing envoyé aux enseignants (après le lien de désabonnement, pour les
        non-adhérents).
      </p>

      {!canEdit ? (
        links.length === 0 ? (
          <p className="hint">Aucun réseau social configuré.</p>
        ) : (
          <ul>
            {links.map((l) => (
              <li key={l.id}>
                {l.label} — {l.url}
              </li>
            ))}
          </ul>
        )
      ) : (
        <form onSubmit={save}>
          {draft.map((row, i) => (
            <div className="inline-form" key={i}>
              <label>
                Nom
                <input type="text" value={row.label} onChange={(e) => updateRow(i, "label", e.target.value)} placeholder="Facebook" />
              </label>
              <label>
                URL
                <input type="url" value={row.url} onChange={(e) => updateRow(i, "url", e.target.value)} placeholder="https://..." />
              </label>
              <button type="button" className="secondary" onClick={() => removeRow(i)}>
                Retirer
              </button>
            </div>
          ))}
          <div className="row-actions" style={{ marginTop: 12 }}>
            <button type="button" className="secondary" onClick={addRow}>
              Ajouter un réseau
            </button>
            <button type="submit" disabled={saving}>
              {saving ? "Enregistrement..." : "Enregistrer"}
            </button>
            {saved && <span className="hint"> Enregistré.</span>}
          </div>
        </form>
      )}
      {saveError && <p className="error-text">{saveError}</p>}
    </section>
  );
}
