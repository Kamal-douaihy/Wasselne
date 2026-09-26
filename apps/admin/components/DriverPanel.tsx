"use client";

import { useRouter } from "next/navigation";
import { bff, errorText } from "./bff";
import { ReasonButton } from "./ReasonDialog";
import { can } from "../lib/permissions";

interface Doc { id: string; document_type_code?: string; document_type_names?: { en?: string }; status: string; review_reason: string | null; expires_on: string | null; vehicle_id: string | null }
export interface DriverDetail {
  id: string; first_name: string | null; last_name: string | null; phone_e164: string; status: string; document_status: string;
  declared_gender?: string; gender_confirmed?: boolean; blocked: boolean; block_pending: boolean; vehicle_plate: string | null;
  vehicles: { make: string; model: string; year: number | null; color: string; plate: string; seats: number; base_type: string }[];
  documents: Doc[];
  category_approvals?: { category_id: string; code: string; status: string; reason: string | null }[];
}

const badge = (s: string) => (["REJECTED", "EXPIRED", "SUSPENDED"].includes(s) ? "badge bad" : ["NEEDS_CHANGES", "EXPIRING", "SUBMITTED", "UPLOADED", "PENDING"].includes(s) ? "badge warn" : "badge");

export function DriverPanel({ driver, roles }: { driver: DriverDetail; roles: string[] }) {
  const router = useRouter();
  const act = (path: string, method: string, body: Record<string, unknown>) => async (reason: string) => {
    const r = await bff(path, method, { ...body, reason });
    if (r.status >= 400) return errorText(r);
    router.refresh();
    return null;
  };
  const review = can(roles, "approvals.review");
  const manage = can(roles, "drivers.manage");
  const block = can(roles, "accounts.block");

  async function openDocument(docId: string) {
    const r = await bff(`driver-approvals/${driver.id}/documents/${docId}/download`);
    if (r.status !== 200) return alert(errorText(r));
    window.open(r.body.url, "_blank", "noopener,noreferrer"); // signed, short-lived; the open was audited server-side
  }

  const name = [driver.first_name, driver.last_name].filter(Boolean).join(" ") || "Driver";
  return (
    <>
      <h2>{name} <span className={badge(driver.status)}>{driver.status}</span> {driver.blocked && <span className="badge bad">Blocked</span>} {driver.block_pending && <span className="badge warn">Block pending — active trip</span>}</h2>
      <div className="card">
        <p>Phone: {driver.phone_e164} · Declared gender: {driver.declared_gender ?? "—"} {driver.gender_confirmed ? "(confirmed)" : "(not confirmed)"} · Documents: <span className={badge(driver.document_status)}>{driver.document_status}</span></p>
        {driver.vehicles.map((v) => <p key={v.plate}>{v.year ?? ""} {v.make} {v.model}, {v.color}, plate {v.plate}, {v.seats} seats ({v.base_type})</p>)}
        <div className="row">
          {review && driver.status === "SUBMITTED" && <ReasonButton label="Approve driver" title="Approve this driver" onConfirm={act(`driver-approvals/${driver.id}/approve`, "POST", {})} />}
          {review && ["SUBMITTED", "NEEDS_CHANGES"].includes(driver.status) && <ReasonButton danger label="Reject driver" title="Reject this application" onConfirm={act(`driver-approvals/${driver.id}/reject`, "POST", {})} />}
          {manage && driver.status === "APPROVED" && <ReasonButton danger label="Suspend" title="Suspend this driver" onConfirm={act(`drivers/${driver.id}/suspend`, "POST", {})} />}
          {manage && driver.status === "SUSPENDED" && <ReasonButton label="Reinstate" title="Reinstate this driver" onConfirm={act(`drivers/${driver.id}/reinstate`, "POST", {})} />}
          {manage && driver.declared_gender && <ReasonButton label={`Confirm gender: ${driver.declared_gender}`} title="Confirm declared gender" onConfirm={act(`drivers/${driver.id}/gender-confirm`, "POST", { confirmed_gender: driver.declared_gender })} />}
          {block && !driver.blocked && !driver.block_pending && <ReasonButton danger label="Block" title="Block this driver (takes effect after any trip in progress)" onConfirm={act(`drivers/${driver.id}/block`, "POST", { applies_to: ["DRIVER"] })} />}
          {block && (driver.blocked || driver.block_pending) && <ReasonButton label="Unblock" title="Unblock this driver" onConfirm={act(`drivers/${driver.id}/unblock`, "POST", {})} />}
        </div>
      </div>

      <h3>Categories</h3>
      <table>
        <thead><tr><th>Category</th><th>Status</th><th>Note</th><th /></tr></thead>
        <tbody>
          {(driver.category_approvals ?? []).map((c) => (
            <tr key={c.category_id}>
              <td>{c.code}</td><td><span className={badge(c.status)}>{c.status}</span></td><td className="muted">{c.reason ?? ""}</td>
              <td>{manage && c.status !== "APPROVED" && <ReasonButton label="Approve" title={`Approve category ${c.code}`} onConfirm={act(`drivers/${driver.id}/categories`, "PATCH", { category_id: c.category_id, status: "APPROVED" })} />}
                  {manage && c.status === "APPROVED" && <ReasonButton danger label="Revoke" title={`Revoke category ${c.code}`} onConfirm={act(`drivers/${driver.id}/categories`, "PATCH", { category_id: c.category_id, status: "REJECTED" })} />}</td>
            </tr>
          ))}
          {(driver.category_approvals ?? []).length === 0 && <tr><td colSpan={4} className="muted">No categories requested.</td></tr>}
        </tbody>
      </table>

      <h3>Documents</h3>
      <table>
        <thead><tr><th>Document</th><th>Status</th><th>Expires</th><th>Note</th><th /></tr></thead>
        <tbody>
          {driver.documents.map((d) => (
            <tr key={d.id}>
              <td>{d.document_type_names?.en ?? d.document_type_code}</td>
              <td><span className={badge(d.status)}>{d.status}</span></td>
              <td>{d.expires_on ?? "—"}</td>
              <td className="muted">{d.review_reason ?? ""}</td>
              <td className="row">
                {can(roles, "documents.view") && <button onClick={() => openDocument(d.id)}>View</button>}
                {review && d.status === "UPLOADED" && <ReasonButton label="Approve" title="Approve this document" onConfirm={act(`driver-approvals/${driver.id}/documents/${d.id}/approve`, "POST", {})} />}
                {review && ["UPLOADED", "APPROVED"].includes(d.status) && <ReasonButton label="Request re-upload" title="Ask the driver to upload this again" onConfirm={act(`driver-approvals/${driver.id}/documents/${d.id}/request-changes`, "POST", {})} />}
                {review && ["UPLOADED", "APPROVED"].includes(d.status) && <ReasonButton danger label="Reject" title="Reject this document" onConfirm={act(`driver-approvals/${driver.id}/documents/${d.id}/reject`, "POST", {})} />}
              </td>
            </tr>
          ))}
          {driver.documents.length === 0 && <tr><td colSpan={5} className="muted">No documents uploaded.</td></tr>}
        </tbody>
      </table>
    </>
  );
}
