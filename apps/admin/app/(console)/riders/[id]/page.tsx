import Link from "next/link";
import { LoadError } from "../../../../components/Denied";
import { RiderDetail, RiderPanel } from "../../../../components/RiderPanel";
import { loadAdmin, requireRoles } from "../../../../lib/server-data";

export default async function RiderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const roles = await requireRoles();
  const res = await loadAdmin<RiderDetail>(`/riders/${id}`);
  return (
    <>
      <p><Link href="/riders">← Riders</Link></p>
      {res.ok ? <RiderPanel rider={res.data} roles={roles} /> : <LoadError status={res.status} message={res.message} />}
    </>
  );
}
