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

export const api = {
  login: (email: string, password: string) =>
    request<{ token: string; user: CurrentUser }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  me: () => request<CurrentUser>("/auth/me"),
  campagnes: () => request<Campagne[]>("/campagnes"),
  teachers: (campagneId: string) => request<TeacherListItem[]>(`/teachers?campagneId=${campagneId}`),
  pendingMatches: () => request<MatchCandidate[]>("/matches?status=PENDING_REVIEW"),
  confirmMatch: (id: string, teacherId?: string) =>
    request(`/matches/${id}/confirm`, { method: "POST", body: JSON.stringify({ teacherId }) }),
  rejectMatch: (id: string) => request(`/matches/${id}/reject`, { method: "POST" }),
  baSeuils: (campagneId: string) => request<BaSeuil[]>(`/ba-seuils?campagneId=${campagneId}`),
  updateBaSeuil: (id: string, data: Partial<Pick<BaSeuil, "minBareme" | "minAncienneteGrade" | "minAncienneteEchelon" | "minAge" | "locked">>) =>
    request<BaSeuil>(`/ba-seuils/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
};
