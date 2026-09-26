import Link from "next/link";
import { LoadError } from "../../../components/Denied";
import { loadAdmin } from "../../../lib/server-data";

interface Log { items: { id: number; admin_name?: string; admin_id: string; action: string; target_type: string; target_id: string; reason: string | null; ip: string | null; created_at: string }[]; next_cursor: string | null }

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ action?: string; target_id?: string; cursor?: string }> }) {
  const sp = await searchParams;
  const q = new URLSearchParams({ limit: "50", ...(sp.action ? { action: sp.action } : {}), ...(sp.target_id ? { target_id: sp.target_id } : {}), ...(sp.cursor ? { cursor: sp.cursor } : {}) });
  const res = await loadAdmin<Log>(`/audit-log?${q}`);
  return (
    <>
      <h2>Audit log</h2>
      <form className="row" style={{ marginBottom: 12 }}>
        <input name="action" placeholder="Action, e.g. driver.approve" defaultValue={sp.action ?? ""} />
        <input name="target_id" placeholder="Target id" defaultValue={sp.target_id ?? ""} />
        <button>Filter</button>
      </form>
      {!res.ok ? <LoadError status={res.status} message={res.message} /> : (
        <>
          <table>
            <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Target</th><th>Reason</th><th>IP</th></tr></thead>
            <tbody>
              {res.data.items.map((e) => (
                <tr key={e.id}>
                  <td>{new Date(e.created_at).toLocaleString("en-GB")}</td><td>{e.admin_name ?? e.admin_id}</td><td>{e.action}</td>
                  <td>{e.target_type} <span className="muted">{e.target_id.slice(0, 8)}</span></td><td>{e.reason ?? ""}</td><td>{e.ip ?? ""}</td>
                </tr>
              ))}
              {res.data.items.length === 0 && <tr><td colSpan={6} className="muted">No entries match.</td></tr>}
            </tbody>
          </table>
          {res.data.next_cursor && <p><Link href={`/audit?${new URLSearchParams({ ...(sp.action ? { action: sp.action } : {}), cursor: res.data.next_cursor })}`}>Older entries</Link></p>}
        </>
      )}
    </>
  );
}
