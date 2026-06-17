import { API_BASE, getAuthToken, ApiError } from "./client";

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getAuthToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...((init.headers as Record<string, string>) ?? {}),
    },
  });
  if (!res.ok) throw new ApiError(res.status, `${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

export type MoneyNode = {
  id: string; label: string; kind: string;
  person_id: number | null; person_label: string | null;
  bank_name: string | null; account_type: string | null;
  district: string | null; kyc_risk_level: string | null;
  total_in: number; total_out: number; degree: number; is_seed: boolean;
};

export type MoneyEdge = {
  source: string; target: string; amount: number; txn_count: number;
  channel: string | null; pattern_flag: string | null;
  is_suspicious: boolean; case_id: number | null;
};

export type MoneyTrailResponse = {
  seed: string; nodes: MoneyNode[]; edges: MoneyEdge[];
  flagged_count: number; total_amount: number; notice: string;
};

export type MoneyTrailRequest = {
  person_id?: string; entity_name?: string; case_id?: number;
  min_amount?: number; suspicious_only?: boolean; depth?: number;
};

export const financial = {
  moneyTrail: (req: MoneyTrailRequest) =>
    apiFetch<MoneyTrailResponse>("/financial/money-trail", {
      method: "POST",
      body: JSON.stringify(req),
    }),
};
