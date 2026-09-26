import { redirect } from "next/navigation";
import { apiCall } from "./api";
import { getRoles, getSessionToken } from "./session";

export type Loaded<T> = { ok: true; data: T } | { ok: false; status: number; message: string };

/** Loads console data server-side. A missing/expired session sends the person to sign-in. */
export async function loadAdmin<T>(path: string): Promise<Loaded<T>> {
  const token = await getSessionToken();
  if (!token) redirect("/login");
  const r = await apiCall<T & { message?: string; correlation_id?: string }>(`/admin${path}`, { token });
  if (r.status === 401) redirect("/login");
  if (r.status !== 200) {
    const b = r.body as { message?: string; correlation_id?: string } | null;
    return { ok: false, status: r.status, message: `${b?.message ?? "Could not load this page."}${b?.correlation_id ? ` Reference: ${b.correlation_id}` : ""}` };
  }
  return { ok: true, data: r.body as T };
}

export async function requireRoles(): Promise<string[]> {
  if (!(await getSessionToken())) redirect("/login");
  return getRoles();
}
