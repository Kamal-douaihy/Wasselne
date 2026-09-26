import Link from "next/link";
import { LoadError } from "../../../components/Denied";
import { loadAdmin } from "../../../lib/server-data";

interface Queue { items: { driver_id: string; driver_name: string; submitted_at: string; categories_requested: string[]; documents_total: number; documents_ready: number; status: string }[]; next_cursor: string | null }
const STATUSES = ["PENDING", "NEEDS_CHANGES", "APPROVED", "REJECTED"];

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ status?: string; cursor?: string }> }) {
  const sp = await searchParams;
  const status = STATUSES.includes(sp.status ?? "") ? sp.status! : "PENDING";
  const q = new URLSearchParams({ status, limit: "20", ...(sp.cursor ? { cursor: sp.cursor } : {}) });
  const res = await loadAdmin<Queue>(`/driver-approvals?${q}`);
  return (
    <>
      <h2>Driver approvals</h2>
      <div className="row" style={{ marginBottom: 12 }}>
        {STATUSES.map((s) => <Link key={s} className="btn" href={`/approvals?status=${s}`} aria-current={s === status ? "true" : undefined}>{s === "PENDING" ? "Pending" : s === "NEEDS_CHANGES" ? "Needs changes" : s[0] + s.slice(1).toLowerCase()}</Link>)}
      </div>
      {!res.ok ? <LoadError status={res.status} message={res.message} /> : (
        <>
          <table>
            <thead><tr><th>Driver</th><th>Submitted</th><th>Categories</th><th>Documents ready</th><th>Status</th></tr></thead>
            <tbody>
              {res.data.items.map((i) => (
                <tr key={i.driver_id}>
                  <td><Link href={`/approvals/${i.driver_id}`}>{i.driver_name || i.driver_id}</Link></td>
                  <td>{new Date(i.submitted_at).toLocaleString("en-GB")}</td>
                  <td>{i.categories_requested.join(", ")}</td>
                  <td>{i.documents_ready}/{i.documents_total}</td>
                  <td><span className="badge">{i.status}</span></td>
                </tr>
              ))}
              {res.data.items.length === 0 && <tr><td colSpan={5} className="muted">The queue is clear.</td></tr>}
            </tbody>
          </table>
          {res.data.next_cursor && <p><Link href={`/approvals?status=${status}&cursor=${encodeURIComponent(res.data.next_cursor)}`}>Next page</Link></p>}
        </>
      )}
    </>
  );
}
