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
  echelonActuel: string;
  dateAccesEchelon: string;
  avisEvaluation: number | null;
  computedState: ComputedState | null;
  matching:
    | { status: "AUTO_CONFIRMED" | "PENDING_REVIEW" | "CONFIRMED" | "REJECTED"; adherentNom: string; adherentPrenom: string }
    | { status: "NON_ADHERENT" };
  seuilBa: { minBareme: number; locked: boolean; nombrePromusBa: number } | null;
  baEstimate: BaEstimate;
  /** null = not applicable (mauvais grade, ou données d'ancienneté manquantes) — pas "non éligible". */
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

export interface RectoratImportResult {
  importId: string;
  grade: string;
  imported: number;
  warnings: { nomUsage: string; prenom: string; warnings: string[] }[];
}

export interface AdherentImportResult {
  created: number;
  updated: number;
  unmappedFields: string[];
  matching: { autoConfirmed: number; pendingReview: number };
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
  adherentId: string;
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
  pendingMatches: () => request<MatchCandidate[]>("/matches?status=PENDING_REVIEW"),
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
  adelLastSync: (type: AdelSyncType) => request<AdelSyncLogEntry | null>(`/adel/last?type=${type}`),
  adelSync: (type: AdelSyncType) => request<AdelSyncResult>("/adel/sync", { method: "POST", body: JSON.stringify({ type }) }),
  mailingEligible: (campagneId: string) => request<MailingRecipient[]>(`/mailing/eligible?campagneId=${campagneId}`),
  mailingPreview: (campagneId: string, teacherId: string) =>
    request<MailingPreview>(`/mailing/preview?campagneId=${campagneId}&teacherId=${teacherId}`),
  mailingLog: (campagneId: string) => request<MailingLogEntry[]>(`/mailing/log?campagneId=${campagneId}`),
  mailingSend: (campagneId: string, teacherIds?: string[]) =>
    request<MailingSendResult>("/mailing/send", { method: "POST", body: JSON.stringify({ campagneId, teacherIds }) }),
};
