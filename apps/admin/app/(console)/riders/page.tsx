import Link from "next/link";
import { LoadError } from "../../../components/Denied";
import { SearchBox } from "../../../components/SearchBox";
import { loadAdmin } from "../../../lib/server-data";

interface List { items: { id: string; first_name: string | null; last_name: string | null; phone_e164: string; declared_gender?: string; gender_confirmed: boolean; trip_count: number; status: string; blocked: boolean; block_pending: boolean; created_at: string }[]; next_cursor: string | null }

export default async function RidersPage({ searchParams }: { searchParams: Promise<{ q?: string; cursor?: string }> }) {
  const sp = await searchParams;
  const q = new URLSearchParams({ limit: "20", ...(sp.q ? { q: sp.q } : {}), ...(sp.cursor ? { cursor: sp.cursor } : {}) });
  const res = await loadAdmin<List>(`/riders?${q}`);
  return (
    <>
      <h2>Riders</h2>
      <SearchBox base="/riders" initial={sp.q ?? ""} />
      {!res.ok ? <LoadError status={res.status} message={res.message} /> : (
        <>
          <table>
            <thead><tr><th>Name</th><th>Phone</th><th>Gender</th><th>Trips</th><th>Signed up</th><th>Status</th></tr></thead>
            <tbody>
              {res.data.items.map((r) => (
                <tr key={r.id}>
                  <td><Link href={`/riders/${r.id}`}>{[r.first_name, r.last_name].filter(Boolean).join(" ") || r.id}</Link></td>
                  <td>{r.phone_e164}</td>
                  <td>{r.declared_gender ?? "—"} {r.gender_confirmed ? "✓" : <span className="badge warn">unconfirmed</span>}</td>
                  <td>{r.trip_count}</td>
                  <td>{new Date(r.created_at).toLocaleDateString("en-GB")}</td>
                  <td>{r.status}{r.blocked ? " · blocked" : ""}{r.block_pending ? " · block pending" : ""}</td>
                </tr>
              ))}
              {res.data.items.length === 0 && <tr><td colSpan={6} className="muted">No results for this search.</td></tr>}
            </tbody>
          </table>
          {res.data.next_cursor && <p><Link href={`/riders?${new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), cursor: res.data.next_cursor })}`}>Next page</Link></p>}
        </>
      )}
    </>
  );
}
