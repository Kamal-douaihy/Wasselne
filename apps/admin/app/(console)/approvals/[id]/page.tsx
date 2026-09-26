import Link from "next/link";
import { DriverDetail, DriverPanel } from "../../../../components/DriverPanel";
import { LoadError } from "../../../../components/Denied";
import { loadAdmin, requireRoles } from "../../../../lib/server-data";

export default async function ApprovalDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const roles = await requireRoles();
  const res = await loadAdmin<DriverDetail>(`/drivers/${id}`);
  return (
    <>
      <p><Link href="/approvals">← Approvals</Link></p>
      {res.ok ? <DriverPanel driver={res.data} roles={roles} /> : <LoadError status={res.status} message={res.message} />}
    </>
  );
}
