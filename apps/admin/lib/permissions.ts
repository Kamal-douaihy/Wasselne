// Which console sections a role can see. This only decides what the navigation shows; the API
// enforces every permission itself. permissions.spec.ts checks this table against the seed in
// db/migrations/020_identity_onboarding_eligibility.sql so the two cannot drift.
export const ROLE_PERMISSIONS: Record<string, string[]> = {
  SUPER_ADMIN: ["riders.read", "riders.gender_confirm", "accounts.block", "drivers.read", "drivers.manage", "approvals.read", "approvals.review", "documents.view", "audit.read", "audit.export"],
  DRIVER_REVIEWER: ["drivers.read", "drivers.manage", "approvals.read", "approvals.review", "documents.view"],
  OPERATIONS: ["riders.read", "drivers.read", "accounts.block"],
  PRICING: [],
  SUPPORT: [],
  SAFETY: [],
  FINANCE: ["riders.read", "drivers.read"],
  CONTENT_EDITOR: [],
  AUDITOR: ["riders.read", "drivers.read", "approvals.read", "audit.read", "audit.export"],
};

export const permissionsOf = (roles: string[]): Set<string> => new Set(roles.flatMap((r) => ROLE_PERMISSIONS[r] ?? []));
export const can = (roles: string[], permission: string): boolean => permissionsOf(roles).has(permission);

export interface NavItem {
  href: string;
  label: string;
  permission: string;
}
export const NAV: NavItem[] = [
  { href: "/approvals", label: "Driver approvals", permission: "approvals.read" },
  { href: "/drivers", label: "Drivers", permission: "drivers.read" },
  { href: "/riders", label: "Riders", permission: "riders.read" },
  { href: "/audit", label: "Audit log", permission: "audit.read" },
];
