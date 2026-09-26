import { NextRequest, NextResponse } from "next/server";
import { apiCall } from "../../../../lib/api";
import { clearMfaToken, clearSession, getMfaToken, getSessionToken, setMfaToken, setSession } from "../../../../lib/session";

// Browser -> this route -> API. Only these prefixes may be proxied, and every state-changing call
// must carry the custom header below: a cross-site form post cannot set it, which (with the
// SameSite=Strict cookie) is the CSRF defence.
const PROXY_PREFIXES = ["riders", "drivers", "driver-approvals", "audit-log"];
const CSRF_HEADER = "x-wasselne-admin";

type Ctx = { params: Promise<{ path: string[] }> };
const json = (status: number, body: unknown) => (status === 204 ? new NextResponse(null, { status }) : NextResponse.json(body, { status }));

async function handle(req: NextRequest, ctx: Ctx): Promise<NextResponse> {
  const { path } = await ctx.params;
  const joined = path.join("/");
  if (req.method !== "GET" && req.headers.get(CSRF_HEADER) !== "1") return json(403, { code: "NOT_AUTHORIZED", message: "Missing CSRF header." });
  const body = req.method === "GET" ? undefined : await req.json().catch(() => ({}));

  // ---- sign-in steps (the browser never sees the mfa_token or the session token)
  if (joined === "auth/login" && req.method === "POST") {
    const r = await apiCall<{ mfa_token?: string; mfa_enrolled?: boolean }>("/admin/auth/login", { method: "POST", body });
    if (r.status === 200 && r.body.mfa_token) {
      await setMfaToken(r.body.mfa_token);
      return json(200, { mfa_enrolled: r.body.mfa_enrolled });
    }
    return json(r.status, r.body);
  }
  if (["auth/mfa/enrol", "auth/mfa/confirm", "auth/mfa/verify", "auth/mfa/recovery"].includes(joined) && req.method === "POST") {
    const mfa = await getMfaToken();
    if (!mfa) return json(401, { code: "NOT_AUTHENTICATED", message: "Sign in again." });
    const r = await apiCall<{ access_token?: string; roles?: string[] }>(`/admin/${joined}`, { method: "POST", body, token: mfa });
    if (r.status === 200 && r.body?.access_token) {
      await setSession(r.body.access_token, r.body.roles ?? []);
      await clearMfaToken();
      return json(200, { roles: r.body.roles });
    }
    return json(r.status, r.body);
  }
  if (joined === "auth/logout" && req.method === "POST") {
    const token = await getSessionToken();
    if (token) await apiCall("/admin/auth/logout", { method: "POST", token });
    await clearSession();
    return json(204, null);
  }

  // ---- everything else: authenticated proxy
  if (!PROXY_PREFIXES.includes(path[0] ?? "")) return json(404, { code: "NOT_FOUND", message: "Unknown route." });
  const token = await getSessionToken();
  if (!token) return json(401, { code: "NOT_AUTHENTICATED", message: "Sign in again." });
  const r = await apiCall(`/admin/${joined}${req.nextUrl.search}`, { method: req.method, body, token });
  return json(r.status === 204 ? 200 : r.status, r.body ?? {});
}

export { handle as GET, handle as POST, handle as PATCH };
