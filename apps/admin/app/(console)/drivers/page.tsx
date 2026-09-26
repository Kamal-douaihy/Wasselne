import Link from "next/link";
import { LoadError } from "../../../components/Denied";
import { SearchBox } from "../../../components/SearchBox";
import { loadAdmin } from "../../../lib/server-data";

interface List { items: { id: string; first_name: string | null; last_name: string | null; phone_e164: string; qualified_categories: string[]; vehicle_plate: string | null; document_status: string; status: string; blocked: boolean; block_pending: boolean }[]; next_cursor: string | null }

export default async function DriversPage({ searchParams }: { searchParams: Promise<{ q?: string; cursor?: string }> }) {
  const sp = await searchParams;
  const q = new URLSearchParams({ limit: "20", ...(sp.q ? { q: sp.q } : {}), ...(sp.cursor ? { cursor: sp.cursor } : {}) });
  const res = await loadAdmin<List>(`/drivers?${q}`);
  return (
    <>
      <h2>Drivers</h2>
      <SearchBox base="/drivers" initial={sp.q ?? ""} />
      {!res.ok ? <LoadError status={res.status} message={res.message} /> : (
        <>
          <table>
            <thead><tr><th>Name</th><th>Phone</th><th>Vehicle</th><th>Categories</th><th>Documents</th><th>Status</th></tr></thead>
            <tbody>
              {res.data.items.map((d) => (
                <tr key={d.id}>
                  <td><Link href={`/drivers/${d.id}`}>{[d.first_name, d.last_name].filter(Boolean).join(" ") || d.id}</Link></td>
                  <td>{d.phone_e164}</td><td>{d.vehicle_plate ?? "—"}</td><td>{d.qualified_categories.join(", ") || "—"}</td>
                  <td>{d.document_status}</td>
                  <td>{d.status}{d.blocked ? " · blocked" : ""}{d.block_pending ? " · block pending" : ""}</td>
                </tr>
              ))}
              {res.data.items.length === 0 && <tr><td colSpan={6} className="muted">No results for this search.</td></tr>}
            </tbody>
          </table>
          {res.data.next_cursor && <p><Link href={`/drivers?${new URLSearchParams({ ...(sp.q ? { q: sp.q } : {}), cursor: res.data.next_cursor })}`}>Next page</Link></p>}
        </>
      )}
    </>
  );
}
