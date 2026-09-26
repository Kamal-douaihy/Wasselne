import { cookies } from "next/headers";

// httpOnly + SameSite=Strict cookies (01_Architecture §6.1). The session token never reaches
// browser JavaScript; the browser talks to this app's /api/bff routes, which add it server-side.
const SESSION = "wsl_admin_session";
const MFA = "wsl_admin_mfa";
const ROLES = "wsl_admin_roles";
const IDLE_SECONDS = 8 * 60 * 60;

const base = () => ({ httpOnly: true, sameSite: "strict" as const, secure: process.env.NODE_ENV === "production", path: "/" });

export async function getSessionToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION)?.value;
}
export async function getMfaToken(): Promise<string | undefined> {
  return (await cookies()).get(MFA)?.value;
}
export async function getRoles(): Promise<string[]> {
  const v = (await cookies()).get(ROLES)?.value;
  return v ? v.split(",").filter(Boolean) : [];
}

export async function setMfaToken(token: string): Promise<void> {
  (await cookies()).set(MFA, token, { ...base(), maxAge: 5 * 60 });
}
export async function clearMfaToken(): Promise<void> {
  (await cookies()).delete(MFA);
}
export async function setSession(token: string, roles: string[]): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION, token, { ...base(), maxAge: IDLE_SECONDS });
  // roles only drive which navigation entries are shown; the API re-checks every request
  jar.set(ROLES, roles.join(","), { ...base(), maxAge: IDLE_SECONDS });
}
export async function clearSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION);
  jar.delete(ROLES);
}
