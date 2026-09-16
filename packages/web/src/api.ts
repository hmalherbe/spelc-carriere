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

export type BaEstimate = "promu_estime" | "non_promu_estime" | "indetermine" | null;

export interface TeacherListItem {
  teacherId: string;
  nom: string;
  prenom: string;
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
  seuilBa: { minBareme: number; locked: boolean; nombrePromusBa: number } | null;
  /** L'échelon de départ (6 ou 8) que la règle BA décrit — la même valeur que dans echelonActuel
   * ci-dessus quand le candidat n'est pas encore confirmé, fournie ici explicitement pour la
   * colonne BA. null = non applicable. */
  baEchelonDepart: 6 | 8 | null;
  /** Résultat du classement des candidats BA de cette section contre l'effectif réel donné par le
   * rectorat (pas d'estimation) : true = promu, false = non promu — les deux sont des faits acquis.
   * null = classement impossible (effectif ou données manquantes) ou baEligible n'est pas true —
   * voir baEstimate dans ce cas pour une estimation de repli. */
  baConfirmee: boolean | null;
  baEstimate: BaEstimate;
  /** null = not applicable (mauvais échelon, ou données d'ancienneté manquantes) — pas "non éligible". */
  baEligible: boolean | null;
  horsClasseEligible: boolean | null;
  classeExceptionnelleEligible: boolean | null;
}

export interface MatchCandidate {
  id: string;
  status: string;
  confidence: number;
  adherent: { id: string; nom: string; prenom: string; grade: string | null; mailPersonnel: string | null };
  teacher: { id: string; snapshots: { nomUsage: string; prenom: string; grade: string }[] } | null;
  teacherId: string | null;
}

export interface BaSeuil {
  id: string;
  campagneId: string;
  grade: string;
  echelonDepart: number;
  nombrePromusBa: number;
  minBareme: number;
  minAncienneteGrade: number;
  minAncienneteEchelon: number;
  minAge: number;
  locked: boolean;
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

export interface MailingRecipient {
  teacherId: string;
  adherentId: string | null;
  /** false = non-adhérent, notified at their academic address (looked up by nom/prénom) instead
   * of a personal one, since none is known for them. */
  isAdherent: boolean;
  nom: string;
  prenom: string;
  civilite: string | null;
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

export interface MailingSendResult {
  sent: number;
  failed: number;
  results: { teacherId: string; nom: string; prenom: string; email: string | null; status: "SENT" | "FAILED"; error?: string }[];
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
  createCampagne: (data: { anneeScolaire: string; periodeDebut: string; periodeFin: string; dateCcma: string }) =>
    request<Campagne>("/campagnes", { method: "POST", body: JSON.stringify(data) }),
  teachers: (campagneId: string) => request<TeacherListItem[]>(`/teachers?campagneId=${campagneId}`),
  pendingMatches: (campagneId?: string) =>
    request<MatchCandidate[]>(`/matches?status=PENDING_REVIEW${campagneId ? `&campagneId=${campagneId}` : ""}`),
  adherentsEligibles: (campagneId: string) => request<AdherentEligible[]>(`/adherents/eligibles?campagneId=${campagneId}`),
  confirmMatch: (id: string, teacherId?: string) =>
    request(`/matches/${id}/confirm`, { method: "POST", body: JSON.stringify({ teacherId }) }),
  rejectMatch: (id: string) => request(`/matches/${id}/reject`, { method: "POST" }),
  baSeuils: (campagneId: string) => request<BaSeuil[]>(`/ba-seuils?campagneId=${campagneId}`),
  updateBaSeuil: (id: string, data: Partial<Pick<BaSeuil, "minBareme" | "minAncienneteGrade" | "minAncienneteEchelon" | "minAge" | "locked">>) =>
    request<BaSeuil>(`/ba-seuils/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
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
  mailingPreview: (campagneId: string, teacherId: string) =>
    request<MailingPreview>(`/mailing/preview?campagneId=${campagneId}&teacherId=${teacherId}`),
  mailingLog: (campagneId: string) => request<MailingLogEntry[]>(`/mailing/log?campagneId=${campagneId}`),
  mailingSend: (campagneId: string, teacherIds?: string[]) =>
    request<MailingSendResult>("/mailing/send", { method: "POST", body: JSON.stringify({ campagneId, teacherIds }) }),
  grilles: () => request<GrillesData>("/grilles"),
  updateEchelonIndice: (grilleCode: string, echelon: string, indice: number) =>
    request<EchelonRowApi>(`/grilles/${encodeURIComponent(grilleCode)}/rows/${encodeURIComponent(echelon)}`, {
      method: "PATCH",
      body: JSON.stringify({ indice }),
    }),
  createValeurDuPoint: (valeur: number, applicableA: string) =>
    request<ValeurDuPointApi>("/grilles/valeur-du-point", { method: "POST", body: JSON.stringify({ valeur, applicableA }) }),
};
