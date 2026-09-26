import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NAV, ROLE_PERMISSIONS, can } from "./permissions";

describe("role permissions", () => {
  it("match the admin_roles seed in the database migration", () => {
    const sql = readFileSync(join(__dirname, "../../../db/migrations/020_identity_onboarding_eligibility.sql"), "utf8");
    const seeded: Record<string, string[]> = {};
    for (const m of sql.matchAll(/\('([A-Z_]+)',\s+ARRAY\[([^\]]*)\]/g)) {
      seeded[m[1]!] = [...m[2]!.matchAll(/'([a-z_.]+)'/g)].map((x) => x[1]!);
    }
    expect(Object.keys(seeded).sort()).toEqual(Object.keys(ROLE_PERMISSIONS).sort());
    for (const [role, perms] of Object.entries(seeded)) expect([...perms].sort()).toEqual([...ROLE_PERMISSIONS[role]!].sort());
  });

  it("every nav entry is gated by a permission some role holds", () => {
    for (const item of NAV) expect(Object.values(ROLE_PERMISSIONS).some((p) => p.includes(item.permission))).toBe(true);
  });

  it("an auditor sees the audit log but cannot review; a reviewer cannot see the audit log", () => {
    expect(can(["AUDITOR"], "audit.read")).toBe(true);
    expect(can(["AUDITOR"], "approvals.review")).toBe(false);
    expect(can(["DRIVER_REVIEWER"], "audit.read")).toBe(false);
  });
});
