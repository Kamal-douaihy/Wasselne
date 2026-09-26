import { loadAdminEnv } from "./env";

export interface ApiResult<T = unknown> {
  status: number;
  body: T;
}

/** Server-side call to the Wasselne API (never from the browser: the session token stays server-side). */
export async function apiCall<T = unknown>(
  path: string, // e.g. "/admin/riders?limit=20", relative to /v1
  opts: { method?: string; body?: unknown; token?: string } = {},
): Promise<ApiResult<T>> {
  const env = loadAdminEnv(process.env);
  const res = await fetch(`${env.API_BASE_URL}/v1${path}`, {
    method: opts.method ?? "GET",
    headers: {
      ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    cache: "no-store",
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { code: "INTERNAL_ERROR", message: "Unexpected response from the API." };
  }
  return { status: res.status, body: body as T };
}
