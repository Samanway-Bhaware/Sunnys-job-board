import type { JobView, RoleView, ScopeView, Status } from "@/lib/jobs/types";
import type { UsageView } from "@/lib/refresh/policy";
import type { RegisterStatus } from "@/lib/sponsor/register";
import type { RunView, StartResult } from "@/lib/refresh/run";

export interface BoardData {
  jobs: JobView[];
  roles: RoleView[];
  scope: ScopeView;
  seenUpTo: number | null;
  lastRefreshAt: number | null;
  activeRun: RunView | null;
  lastRun: RunView | null;
  usage: UsageView | null;
  cooldownRemainingMs: number;
  register: RegisterStatus;
}

export interface ScraperInfo {
  id: string;
  name: string;
  requiresKey: boolean;
  configured: boolean;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });

  if (response.status === 401) {
    window.location.replace(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
    throw new ApiError("Please sign in again.", 401, "not_authenticated");
  }

  const data = (await response.json().catch(() => null)) as
    | ({ ok: true } & T)
    | { ok: false; message?: string; error?: string }
    | null;

  if (!response.ok || !data || data.ok === false) {
    const message = data && "message" in data && data.message ? data.message : "Something went wrong.";
    const code = data && "error" in data && data.error ? data.error : "error";
    throw new ApiError(message, response.status, code);
  }
  return data as T;
}

export interface SettingsData {
  scope: ScopeView;
  provider: string;
  model: string | null;
  seenUpTo: number | null;
  lastRefreshAt: number | null;
  providers: unknown[];
  scrapers?: ScraperInfo[];
  cooldownMinutes: number;
  dailyCap: number;
  usage: UsageView | null;
  lastRun: RunView | null;
  register: RegisterStatus;
}

export const api = {
  settings: () => call<SettingsData>("/api/settings"),

  board: () => call<BoardData>("/api/jobs"),

  patchJob: (id: string, patch: { status?: Status; notes?: string }) =>
    call<{ job: JobView }>(`/api/jobs/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  createRole: (input: { name: string; keywords: string }) =>
    call<{ role: RoleView; run: RunView | null; search: StartResult }>("/api/roles", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  updateRole: (id: string, patch: { name?: string; keywords?: string; enabled?: boolean }) =>
    call<{ role: RoleView }>(`/api/roles/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),

  reorderRoles: (order: string[]) =>
    call<{ roles: RoleView[] }>("/api/roles", { method: "PATCH", body: JSON.stringify({ order }) }),

  deleteRole: (id: string) =>
    call<{ outcome: { kind: "deleted" | "archived" } }>(`/api/roles/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),

  refresh: (trigger: "visit" | "manual") =>
    call<StartResult>("/api/refresh", { method: "POST", body: JSON.stringify({ trigger }) }),

  run: (id: string) => call<{ run: RunView }>(`/api/refresh/${encodeURIComponent(id)}`),

  updateScope: (scope: ScopeView) =>
    call<{ scope: ScopeView }>("/api/settings", { method: "PATCH", body: JSON.stringify(scope) }),

  logout: () => call<Record<string, never>>("/api/logout", { method: "POST", body: "{}" }),
};
