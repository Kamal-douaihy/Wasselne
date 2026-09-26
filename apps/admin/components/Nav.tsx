"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { NAV, can } from "../lib/permissions";
import { bff } from "./bff";

export function Nav({ roles }: { roles: string[] }) {
  const path = usePathname();
  const router = useRouter();
  async function signOut() {
    await bff("auth/logout", "POST");
    router.push("/login");
    router.refresh();
  }
  return (
    <nav className="nav" aria-label="Main">
      <h1>Wasselne Admin</h1>
      {NAV.filter((n) => can(roles, n.permission)).map((n) => (
        <Link key={n.href} href={n.href} aria-current={path.startsWith(n.href) ? "page" : undefined}>
          {n.label}
        </Link>
      ))}
      <div style={{ flex: 1 }} />
      <p className="muted" style={{ fontSize: 12 }}>{roles.join(", ") || "no role"}</p>
      <button onClick={signOut}>Sign out</button>
    </nav>
  );
}
