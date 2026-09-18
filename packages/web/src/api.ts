const API_BASE = "/api";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

function getToken(): string | null {
  return localStorage.getItem("spelc_token");
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem("spelc_token", token);
  else localStorage.removeItem("spelc_token");
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(body.error ?? "Erreur inconnue", res.status);
  }
  return res.json() as Promise<T>;
}

/** Like `request`, but for multipart/form-data uploads — no Content-Type override, so the
 * browser sets the correct boundary itself. */
async function upload<T>(path: string, formData: FormData): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: formData,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(body.error ?? "Erreur inconnue", res.status);
  }
  return res.json() as Promise<T>;
}

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "GESTIONNAIRE" | "LECTURE";
}

export interface Campagne {
  id: string;
  anneeScolaire: string;
  periodeDebut: string;
  periodeFin: string;
  dateCcma: string;
  /** CCMA (second degré) ou CCMI (premier degré) — chaque campagne est entièrement l'une ou
   * l'autre, jamais mélangée ; détermine les élus insérés dans les mailings de cette campagne
   * (page Élus CCMA/CCMI). null seulement pour une campagne créée avant l'ajout de ce champ. */
  type: "CCMA" | "CCMI" | null;
  _count: { teacherSnapshots: number; imports: number };
}

export interface ComputedState {
  grilleCode: string;
  echelonSuivant: string;
  indiceActuel: number;
  futurIndice: number;
  gainSalaireBrut: number;
  gainSalaireNet: number;
  dateProchainePromotion: string | null;
}

export interface TeacherListItem {
  teacherId: string;
  nom: string;
  prenom: string;
  /** Position occupée par cette fiche dans le fichier du rectorat d'origine — n'a de sens qu'au
   * sein d'un même grade (chaque grade vient de son propre fichier). Voir le tri "fichier" de
   * DashboardPage.tsx, qui groupe par grade puis trie sur cette valeur. */
  fileOrder: number;
  grade: string;
  /** Échelon actuel corrigé pour l'affichage : pour un candidat BA pas encore confirmé, c'est
   * l'échelon de départ réel (6 ou 8), pas l'échelon d'arrivée tel que titré par le rectorat
   * (07/09) — voir baEchelonDepart, qui donne la même valeur explicitement pour la colonne BA. */
  echelonActuel: string;
  dateAccesEchelon: string;
  ancienneteEchelon: number | null;
  avisEvaluation: number | null;
  computedState: ComputedState | null;
  matching:
    | { status: "AUTO_CONFIRMED" | "PENDING_REVIEW" | "CONFIRMED" | "REJECTED"; adherentNom: string; adherentPrenom: string }
    | { status: "NON_ADHERENT" };
  /** L'échelon de départ (6 ou 8) que la règle BA décrit — la même valeur que dans echelonActuel
   * ci-dessus quand le candidat n'est pas encore confirmé, fournie ici explicitement pour la
   * colonne BA. null = non applicable. */
  baEchelonDepart: 6 | 8 | null;
  /** "hors_fenetre" = candidat BA (marqueur "BA." présent) mais ancienneté hors de la fenêtre
   * officielle — anomalie à vérifier. "national" = agrégé, candidat BA dans la fenêtre — la
   * promotion se décide au niveau national, non déterminable depuis ce fichier, donc seule la
   * candidature est affichée. "promu" / "non_promu" = candidat BA d'un autre grade, dans la
   * fenêtre, statut donné directement par le marqueur "Pro" du rectorat ("Pro BA." = promu, "BA."
   * seul = éligible mais pas promu). null = pas candidat BA ce cycle (pas de marqueur "BA."),
   * quel que soit baEligible — un enseignant suivi sur un autre mécanisme (AN/CL/RE) ce tour-ci,
   * ou hors-classe/classe-exceptionnelle, n'a simplement rien à voir avec la BA. */
  baStatus: "hors_fenetre" | "national" | "promu" | "non_promu" | null;
  /** null = not applicable (mauvais échelon, ou données d'ancienneté manquantes) — pas "non éligible". */
  baEligible: boolean | null;
  horsClasseEligible: boolean | null;
  classeExceptionnelleEligible: boolean | null;
  /** Correction manuelle "ancienneté à déduire" (interruption de carrière non reflétée par la date
   * d'accès à l'échelon du rectorat) — "AAaMMmJJj", ou null si aucune correction n'est en place. */
  ancienneteADeduire: string | null;
  ancienneteADeduireNote: string | null;
}

export interface MatchCandidate {
  id: string;
  status: string;
  confidence: number;
  adherent: { id: string; nom: string; prenom: string; grade: string | null; mailPersonnel: string | null };
  teacher: { id: string; snapshots: { nomUsage: string; prenom: string; grade: string }[] } | null;
  teacherId: string | null;
}

export interface AdherentEligible {
  adherentId: string;
  nom: string;
  prenom: string;
  grade: string | null;
  /** 2 = second degré (CCMA), 1 = premier degré (CCMI), null = grade inconnu. */
  degre: 1 | 2 | null;
  dateProchainePromotion: string | null;
  nonPresentDansRectorat: boolean;
}

/** One grade's worth of results from a rectorat import — a file usually holds just one grade, but a
 * combined "CN-HC-CE" export detects and imports several, each reported separately here. */
export interface RectoratGradeImportResult {
  gradeCode: string;
  grade: string;
  imported: number;
  warnings: { nomUsage: string; prenom: string; warnings: string[] }[];
  /** Set instead of `imported`/`warnings` being meaningful when this block's grade code isn't recognized. */
  error?: string;
}

export interface RectoratImportResult {
  results: RectoratGradeImportResult[];
}

export interface AdherentImportResult {
  created: number;
  updated: number;
  unmappedFields: string[];
  matching: { autoConfirmed: number; pendingReview: number };
}

export interface AcademicEmailImportResult {
  imported: number;
}

export type AdelSyncType = "CCMA" | "CCMI";

export interface AdelSyncLogEntry {
  id: string;
  type: AdelSyncType;
  status: "SUCCESS" | "FAILED";
  syncedAt: string;
  created: number;
  updated: number;
  error: string | null;
}

export interface AdelSyncResult {
  syncedAt: string;
  created: number;
  updated: number;
  unmappedFields: string[];
  matching: { autoConfirmed: number; pendingReview: number };
}

export interface AdelSettings {
  loginUrl: string | null;
  username: string | null;
  spelcName: string;
  /** Never the password itself — only whether one is currently configured. */
  hasPassword: boolean;
  updatedAt: string | null;
}

export interface MailingRecipient {
  teacherId: string;
  adherentId: string | null;
  /** false = non-adhérent, notified at their academic address (looked up by nom/prénom) instead
   * of a personal one, since none is known for them. */
  isAdherent: boolean;
  nom: string;
  prenom: string;
  civilite: string | null;
  /** true when `civilite` was guessed from the prénom (non-adhérent, no declared value) — display
   * it as an estimation, never as a fact. */
  civiliteEstimee: boolean;
  grade: string;
  echelonDepart: string;
  echelonSuivant: string;
  indiceActuel: number;
  futurIndice: number;
  gainSalaireBrut: number;
  gainSalaireNet: number;
  dateProchainePromotion: string | null;
  email: string | null;
  lastStatus: "SENT" | "FAILED" | null;
  lastSentAt: string | null;
  lastError: string | null;
}

export interface MailingPreview {
  to: string | null;
  subject: string;
  html: string;
}

/** "generique" = le mailing standard. "ccma_avancement" = le modèle reconstruit à partir du
 * courrier CCMA original (report d'ancienneté, bonification, comparaison au dernier promu...) —
 * n'existe que pour une campagne de type CCMA. */
export type MailingTemplate = "generique" | "ccma_avancement";

export interface MailingSendResult {
  sent: number;
  failed: number;
  results: { teacherId: string; nom: string; prenom: string; email: string | null; status: "SENT" | "FAILED"; error?: string }[];
  /** true when this send was redirected to the test address (Paramètres) rather than real recipients. */
  testMode: boolean;
}

export interface BrevoSettings {
  senderEmail: string | null;
  senderName: string;
  /** Never the API key itself — only whether one is currently configured. */
  hasApiKey: boolean;
  testMode: boolean;
  testEmail: string | null;
  testMaxSends: number | null;
  updatedAt: string | null;
}

export interface MistralSettings {
  model: string;
  /** Never the API key itself — only whether one is currently configured. */
  hasApiKey: boolean;
  updatedAt: string | null;
}

export interface AiAssistantAnswer {
  sql: string;
  rowCount: number;
  rows: Record<string, unknown>[];
  summary: string;
}

export interface Elu {
  id: string;
  commission: "CCMA" | "CCMI";
  role: "TITULAIRE" | "SUPPLEANT";
  prenom: string;
  nom: string;
  telephone: string | null;
  email: string | null;
}

export interface EluInput {
  commission: "CCMA" | "CCMI";
  role: "TITULAIRE" | "SUPPLEANT";
  prenom: string;
  nom: string;
  telephone?: string;
  email?: string;
}

export interface MailingBranding {
  t1Text: string | null;
  logoDataUrl: string | null;
}

export interface SocialLink {
  id: string;
  label: string;
  url: string;
  ordre: number;
}

interface GenreBreakdown {
  hommes: { n: number; pct: number };
  femmes: { n: number; pct: number };
  indetermine: { n: number; pct: number };
}

export interface CampagneStats {
  /** Tous les grades présents dans la campagne — indépendant du filtre `grade` éventuellement
   * appliqué à cette même réponse, pour que le menu qui le pilote ne se réduise pas à une option
   * une fois un grade sélectionné. */
  grades: string[];
  ba: {
    promus: number;
    nonPromus: number;
    /** promus + nonPromus — agrégés ("national", décision ministérielle) et anomalies
     * ("hors_fenetre") en sont exclus, faute d'un vrai appel promu/non-promu pour eux. */
    promouvables: number;
    pctPromus: number;
    national: number;
    horsFenetre: number;
    genre: GenreBreakdown;
  };
  tousLesPromus: {
    total: number;
    genre: GenreBreakdown;
  };
}

export interface MailingLogEntry {
  id: string;
  teacherId: string;
  adherentId: string;
  email: string;
  status: "SENT" | "FAILED";
  error: string | null;
  sentAt: string;
}

export interface EchelonRowApi {
  id: string;
  grilleCode: string;
  echelon: string;
  echelonSuivant: string;
  indice: number;
  dureeAnnees: number | null;
  dureeAlternative: number | null;
}

export interface GrilleApi {
  code: string;
  label: string;
  rows: EchelonRowApi[];
}

export interface GradeMappingApi {
  grade: string;
  grilleCode: string;
  degre: number;
  accesHorsClasse: boolean;
  accesClasseExceptionnelle: boolean;
}

export interface ValeurDuPointApi {
  id: string;
  valeur: number;
  applicableA: string;
}

export interface GrillesData {
  grilles: GrilleApi[];
  gradeMappings: GradeMappingApi[];
  valeurDuPoint: ValeurDuPointApi | null;
}

export const api = {
  login: (email: string, password: string) =>
    request<{ token: string; user: CurrentUser }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  me: () => request<CurrentUser>("/auth/me"),
  campagnes: () => request<Campagne[]>("/campagnes"),
  createCampagne: (data: { anneeScolaire: string; periodeDebut: string; periodeFin: string; dateCcma: string; type: "CCMA" | "CCMI" }) =>
    request<Campagne>("/campagnes", { method: "POST", body: JSON.stringify(data) }),
  updateCampagneType: (id: string, type: "CCMA" | "CCMI") =>
    request<Campagne>(`/campagnes/${id}`, { method: "PATCH", body: JSON.stringify({ type }) }),
  teachers: (campagneId: string) => request<TeacherListItem[]>(`/teachers?campagneId=${campagneId}`),
  updateAncienneteADeduire: (teacherId: string, ancienneteADeduire: string | null, ancienneteADeduireNote: string | null) =>
    request<{ ancienneteADeduire: string | null; ancienneteADeduireNote: string | null; warnings: string[] }>(
      `/teachers/${teacherId}/anciennete-a-deduire`,
      { method: "PUT", body: JSON.stringify({ ancienneteADeduire, ancienneteADeduireNote }) },
    ),
  stats: (campagneId: string, grade?: string) =>
    request<CampagneStats>(`/stats?campagneId=${campagneId}${grade ? `&grade=${encodeURIComponent(grade)}` : ""}`),
  pendingMatches: () => request<MatchCandidate[]>("/matches?status=PENDING_REVIEW"),
  adherentsEligibles: (campagneId: string) => request<AdherentEligible[]>(`/adherents/eligibles?campagneId=${campagneId}`),
  confirmMatch: (id: string, teacherId?: string) =>
    request(`/matches/${id}/confirm`, { method: "POST", body: JSON.stringify({ teacherId }) }),
  rejectMatch: (id: string) => request(`/matches/${id}/reject`, { method: "POST" }),
  rescanMatches: () => request<{ autoConfirmed: number; pendingReview: number }>(`/matches/rescan`, { method: "POST" }),
  importRectorat: (campagneId: string, file: File) => {
    const form = new FormData();
    form.append("campagneId", campagneId);
    form.append("file", file);
    return upload<RectoratImportResult>("/imports/rectorat", form);
  },
  importAdherents: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return upload<AdherentImportResult>("/imports/adherents", form);
  },
  importAcademicEmails: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return upload<AcademicEmailImportResult>("/imports/academic-emails", form);
  },
  adelLastSync: (type: AdelSyncType) => request<AdelSyncLogEntry | null>(`/adel/last?type=${type}`),
  adelSync: (type: AdelSyncType) => request<AdelSyncResult>("/adel/sync", { method: "POST", body: JSON.stringify({ type }) }),
  mailingEligible: (campagneId: string) => request<MailingRecipient[]>(`/mailing/eligible?campagneId=${campagneId}`),
  mailingPreview: (campagneId: string, teacherId: string, template?: MailingTemplate) =>
    request<MailingPreview>(
      `/mailing/preview?campagneId=${campagneId}&teacherId=${teacherId}${template ? `&template=${template}` : ""}`,
    ),
  mailingLog: (campagneId: string) => request<MailingLogEntry[]>(`/mailing/log?campagneId=${campagneId}`),
  mailingSend: (campagneId: string, teacherIds?: string[], template?: MailingTemplate) =>
    request<MailingSendResult>("/mailing/send", { method: "POST", body: JSON.stringify({ campagneId, teacherIds, template }) }),
  updateMailingEmail: (teacherId: string, email: string) =>
    request<{ email: string }>(`/mailing/${teacherId}/email`, { method: "PUT", body: JSON.stringify({ email }) }),
  grilles: () => request<GrillesData>("/grilles"),
  updateEchelonIndice: (grilleCode: string, echelon: string, indice: number) =>
    request<EchelonRowApi>(`/grilles/${encodeURIComponent(grilleCode)}/rows/${encodeURIComponent(echelon)}`, {
      method: "PATCH",
      body: JSON.stringify({ indice }),
    }),
  createValeurDuPoint: (valeur: number, applicableA: string) =>
    request<ValeurDuPointApi>("/grilles/valeur-du-point", { method: "POST", body: JSON.stringify({ valeur, applicableA }) }),
  adelSettings: () => request<AdelSettings>("/settings/adel"),
  updateAdelSettings: (data: { loginUrl: string; username: string; password?: string; spelcName: string }) =>
    request<AdelSettings>("/settings/adel", { method: "PUT", body: JSON.stringify(data) }),
  brevoSettings: () => request<BrevoSettings>("/settings/brevo"),
  updateBrevoSettings: (data: {
    senderEmail: string;
    senderName: string;
    apiKey?: string;
    testMode: boolean;
    testEmail?: string;
    testMaxSends?: number;
  }) => request<BrevoSettings>("/settings/brevo", { method: "PUT", body: JSON.stringify(data) }),
  elus: (commission?: "CCMA" | "CCMI") => request<Elu[]>(`/elus${commission ? `?commission=${commission}` : ""}`),
  createElu: (data: EluInput) => request<Elu>("/elus", { method: "POST", body: JSON.stringify(data) }),
  updateElu: (id: string, data: Partial<EluInput>) => request<Elu>(`/elus/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  deleteElu: (id: string) => request<void>(`/elus/${id}`, { method: "DELETE" }),
  mailingBranding: () => request<MailingBranding>("/settings/mailing-branding"),
  updateMailingBrandingText: (t1Text: string) =>
    request<MailingBranding>("/settings/mailing-branding", { method: "PUT", body: JSON.stringify({ t1Text }) }),
  uploadMailingLogo: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return upload<MailingBranding>("/settings/mailing-branding/logo", form);
  },
  deleteMailingLogo: () => request<MailingBranding>("/settings/mailing-branding/logo", { method: "DELETE" }),
  socialLinks: () => request<SocialLink[]>("/settings/social-links"),
  updateSocialLinks: (links: { label: string; url: string }[]) =>
    request<SocialLink[]>("/settings/social-links", { method: "PUT", body: JSON.stringify({ links }) }),
  mistralSettings: () => request<MistralSettings>("/settings/mistral"),
  updateMistralSettings: (data: { model: string; apiKey?: string }) =>
    request<MistralSettings>("/settings/mistral", { method: "PUT", body: JSON.stringify(data) }),
  aiAssistantSuggestions: () => request<{ questions: string[] }>("/ai-assistant/suggestions"),
  askAiAssistant: (question: string) =>
    request<AiAssistantAnswer>("/ai-assistant/ask", { method: "POST", body: JSON.stringify({ question }) }),
};
