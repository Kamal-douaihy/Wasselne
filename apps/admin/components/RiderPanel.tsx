"use client";

import { useRouter } from "next/navigation";
import { bff, errorText } from "./bff";
import { ReasonButton } from "./ReasonDialog";
import { can } from "../lib/permissions";

export interface RiderDetail {
  id: string; first_name: string | null; last_name: string | null; phone_e164: string; email: string | null; status: string;
  declared_gender?: string; gender_confirmed: boolean; trip_count: number; blocked: boolean; block_pending: boolean;
  recent_rides: { id: string; status: string; requested_at: string; destination_text: string | null }[];
}

export function RiderPanel({ rider, roles }: { rider: RiderDetail; roles: string[] }) {
  const router = useRouter();
  const act = (path: string, body: Record<string, unknown>) => async (reason: string) => {
    const r = await bff(path, "POST", { ...body, reason });
    if (r.status >= 400) return errorText(r);
    router.refresh();
    return null;
  };
  const name = [rider.first_name, rider.last_name].filter(Boolean).join(" ") || "Rider";
  return (
    <>
      <h2>{name} {rider.blocked && <span className="badge bad">Blocked</span>} {rider.block_pending && <span className="badge warn">Block pending — active trip</span>}</h2>
      <div className="card">
        <p>Phone: {rider.phone_e164} · Email: {rider.email ?? "—"} · Completed trips: {rider.trip_count}</p>
        <p>Declared gender: {rider.declared_gender ?? "—"} — {rider.gender_confirmed ? "confirmed by management" : "pending confirmation"}</p>
        <div className="row">
          {can(roles, "riders.gender_confirm") && rider.declared_gender && !rider.gender_confirmed && rider.trip_count > 0 && (
            <ReasonButton label={`Confirm gender: ${rider.declared_gender}`} title="Confirm declared gender" onConfirm={act(`riders/${rider.id}/gender-confirm`, { confirmed_gender: rider.declared_gender })} />
          )}
          {can(roles, "accounts.block") && !rider.blocked && !rider.block_pending && <ReasonButton danger label="Block" title="Block this rider (takes effect after any trip in progress)" onConfirm={act(`riders/${rider.id}/block`, { applies_to: ["RIDER"] })} />}
          {can(roles, "accounts.block") && (rider.blocked || rider.block_pending) && <ReasonButton label="Unblock" title="Unblock this rider" onConfirm={act(`riders/${rider.id}/unblock`, {})} />}
        </div>
      </div>
      <h3>Recent trips</h3>
      <table>
        <thead><tr><th>Requested</th><th>Status</th><th>Destination</th></tr></thead>
        <tbody>
          {rider.recent_rides.map((r) => <tr key={r.id}><td>{r.requested_at}</td><td>{r.status}</td><td>{r.destination_text ?? "—"}</td></tr>)}
          {rider.recent_rides.length === 0 && <tr><td colSpan={3} className="muted">No trips yet.</td></tr>}
        </tbody>
      </table>
    </>
  );
}
