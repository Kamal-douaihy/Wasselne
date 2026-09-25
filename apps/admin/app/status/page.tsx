import { loadAdminEnv } from "../../lib/env";

interface HealthReport {
  status: "ok" | "degraded";
  checks: { database: "ok" | "error"; redis: "ok" | "error" };
}

async function fetchHealth(): Promise<{ ok: boolean; report?: HealthReport; error?: string }> {
  const env = loadAdminEnv(process.env);
  try {
    const res = await fetch(`${env.API_BASE_URL}/health`, { cache: "no-store" });
    const report = (await res.json()) as HealthReport;
    return { ok: res.ok, report };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export default async function StatusPage() {
  const { ok, report, error } = await fetchHealth();

  return (
    <main>
      <h1>System status</h1>
      {report ? (
        <ul>
          <li>API: {report.status}</li>
          <li>Database: {report.checks.database}</li>
          <li>Redis: {report.checks.redis}</li>
        </ul>
      ) : (
        <p>Could not reach the API: {error}</p>
      )}
      <p data-testid="overall">{ok ? "All systems reachable." : "Degraded or unreachable."}</p>
    </main>
  );
}
