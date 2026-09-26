import { redirect } from "next/navigation";
import { NAV, can } from "../../lib/permissions";
import { requireRoles } from "../../lib/server-data";

export default async function Home() {
  const roles = await requireRoles();
  const first = NAV.find((n) => can(roles, n.permission));
  if (first) redirect(first.href);
  return (
    <>
      <h2>Welcome</h2>
      <p className="muted">Your role has no screens available yet. Screens for other roles arrive in later phases.</p>
    </>
  );
}
