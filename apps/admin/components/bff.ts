"use client";

export interface BffResult<T = any> {
  status: number;
  body: T;
}

/** Browser -> the console's own /api/bff route (which holds the session cookie). */
export async function bff<T = any>(path: string, method = "GET", body?: unknown): Promise<BffResult<T>> {
  const res = await fetch(`/api/bff/${path}`, {
    method,
    headers: { "Content-Type": "application/json", "X-Wasselne-Admin": "1" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }
  return { status: res.status, body: parsed as T };
}

/** A message a person can act on, without leaking internals. Always shows the reference code. */
export function errorText(r: BffResult): string {
  const b = r.body as { message?: string; correlation_id?: string; details?: { reasons?: string[]; blocking?: unknown; missing?: string[] } } | null;
  const extra = b?.details?.reasons?.length ? ` (${b.details.reasons.join(", ")})` : "";
  const ref = b?.correlation_id ? ` Reference: ${b.correlation_id}` : "";
  if (r.status === 403) return `You don't have permission to do this.${ref}`;
  return `${b?.message ?? "Something went wrong."}${extra}${ref}`;
}
