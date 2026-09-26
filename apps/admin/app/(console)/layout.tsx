import type { ReactNode } from "react";
import { Nav } from "../../components/Nav";
import { requireRoles } from "../../lib/server-data";

export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  const roles = await requireRoles();
  return (
    <div className="shell">
      <Nav roles={roles} />
      <main className="main">{children}</main>
    </div>
  );
}
