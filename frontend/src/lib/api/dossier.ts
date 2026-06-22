/**
 * Person 360 dossier API client — admin-only (clearance L4+).
 * Calls /api/dossier/* which reads only demo_dossier_* tables (isolated).
 */
import { API_BASE, getAuthToken } from "./client";

async function apiFetch<T>(path: string): Promise<T> {
  const token = getAuthToken();
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

// ── Types ──────────────────────────────────────────────────────────────────

export type DossierListItem = {
  demo_id: number;
  slug: string;
  full_name: string;
  age: number | null;
  district: string | null;
  risk_level: string | null;
  wanted_status: string | null;
  photo_front: string | null;
};

export type DossierFamilyItem = {
  id: number;
  name: string;
  relation: string;
  age: number | null;
  phone: string | null;
  occupation: string | null;
  address: string | null;
  notes: string | null;
};

export type DossierBankAccount = {
  id: number;
  bank_name: string;
  account_no: string;
  ifsc: string | null;
  branch: string | null;
  account_type: string | null;
  balance_inr: number | null;
  status: string | null;
  opened_on: string | null;
  flagged: boolean;
  flag_reason: string | null;
};

export type DossierCrime = {
  id: number;
  case_ref: string;
  crime_type: string;
  sections: string | null;
  role: string | null;
  status: string | null;
  occurred_on: string | null;
  station: string | null;
  district: string | null;
  sentence: string | null;
  narrative: string | null;
};

export type DossierContact = {
  id: number;
  label: string | null;
  name: string | null;
  relation: string | null;
  phone: string | null;
  notes: string | null;
};

export type DossierDetail = {
  demo_id: number;
  slug: string;
  full_name: string;
  aliases: string[] | null;
  gender: string | null;
  dob: string | null;
  age: number | null;
  height_cm: number | null;
  build: string | null;
  complexion: string | null;
  identifying_marks: string | null;
  blood_group: string | null;
  nationality: string | null;
  risk_level: string | null;
  wanted_status: string | null;
  primary_phone: string | null;
  secondary_phone: string | null;
  email: string | null;
  home_address: string | null;
  district: string | null;
  pincode: string | null;
  photo_front: string | null;
  photo_left: string | null;
  photo_right: string | null;
  summary: string | null;
  created_at: string | null;
  family: DossierFamilyItem[];
  banks: DossierBankAccount[];
  crimes: DossierCrime[];
  contacts: DossierContact[];
  bank_account_count: number;
  total_balance_inr: number;
  open_case_count: number;
};

// ── API functions ──────────────────────────────────────────────────────────

export const dossier = {
  list: () => apiFetch<DossierListItem[]>("/api/dossier/list"),
  detail: (id: number) => apiFetch<DossierDetail>(`/api/dossier/${id}`),
};
