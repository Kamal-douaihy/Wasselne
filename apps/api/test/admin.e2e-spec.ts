// Admin sign-in with mandatory MFA, role/permission enforcement on every admin route implemented so
// far, audit logging, blocks (D-34, D-41), gender confirmation (D-39) and concurrency of decisions.
import { authenticator } from "otplib";
import request from "supertest";
import { randomUUID } from "node:crypto";
import {
  JPEG, PNG, TestAdmin, adminSession, adminWith, approveDriverViaApi, createAdmin, createCategory, createRide, onboardDriver, signIn, signUp, uploadFile,
} from "./support/fixtures";
import { TestContext, call, createTestContext, freshIp, randomPhone, requestCode } from "./support/test-app";

// codes for the previous/next 30 s step, so one admin can sign in more than once without replaying a code
const codeAt = (secret: string, stepOffset: number) => {
  const c = authenticator.clone({ epoch: Date.now() + stepOffset * 30_000 });
  return c.generate(secret);
};

describe("admin console API", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext({ OTP_RESEND_INTERVAL_S: "0" });
  });
  afterAll(() => ctx.close());

  describe("sign-in and MFA", () => {
    it("first sign-in: password -> enrol (secret, QR URI, 10 recovery codes) -> confirm -> code -> session", async () => {
      const a = await createAdmin(ctx, ["AUDITOR"], { enrolled: false });
      const login = await call(ctx, "post", "/admin/auth/login", { body: { email: a.email, password: a.password } });
      expect(login.status).toBe(200);
      expect(login.body).toMatchObject({ mfa_required: true, mfa_enrolled: false });

      const enrol = await call(ctx, "post", "/admin/auth/mfa/enrol", { token: login.body.mfa_token });
      expect(enrol.status).toBe(200);
      expect(enrol.body.recovery_codes).toHaveLength(10);
      expect(enrol.body.qr_uri).toMatch(/^otpauth:\/\/totp\//);
      expect(enrol.body.qr_uri).toContain(enrol.body.secret);

      const stored = await ctx.pool.query("select totp_secret_enc, mfa_enrolled_at from admin_users where id = $1", [a.id]);
      expect(stored.rows[0].mfa_enrolled_at).toBeNull();
      expect(stored.rows[0].totp_secret_enc.toString("utf8")).not.toContain(enrol.body.secret); // encrypted at rest
      const hashes = await ctx.pool.query("select code_hash from admin_recovery_codes where admin_id = $1", [a.id]);
      expect(hashes.rows).toHaveLength(10);
      for (const c of enrol.body.recovery_codes) expect(hashes.rows.map((r) => r.code_hash)).not.toContain(c);

      const early = await call(ctx, "post", "/admin/auth/mfa/verify", { token: login.body.mfa_token, body: { code: authenticator.generate(enrol.body.secret) } });
      expect(early.status).toBe(401); // not enrolled yet: no session before confirmation

      expect((await call(ctx, "post", "/admin/auth/mfa/confirm", { token: login.body.mfa_token, body: { code: "000000" } })).status).toBe(400);
      expect((await call(ctx, "post", "/admin/auth/mfa/confirm", { token: login.body.mfa_token, body: { code: authenticator.generate(enrol.body.secret) } })).status).toBe(204);
      expect((await call(ctx, "post", "/admin/auth/mfa/enrol", { token: login.body.mfa_token })).status).toBe(409); // cannot re-enrol silently

      const session = await call(ctx, "post", "/admin/auth/mfa/verify", { token: login.body.mfa_token, body: { code: codeAt(enrol.body.secret, 1) } });
      expect(session.status).toBe(200);
      expect(session.body.roles).toEqual(["AUDITOR"]);
      expect((await call(ctx, "get", "/admin/riders", { token: session.body.access_token })).status).toBe(200);
    });

    it("a captured TOTP code cannot be replayed", async () => {
      const a = await createAdmin(ctx, ["AUDITOR"]);
      const login = await call(ctx, "post", "/admin/auth/login", { body: { email: a.email, password: a.password } });
      const code = authenticator.generate(a.totpSecret);
      expect((await call(ctx, "post", "/admin/auth/mfa/verify", { token: login.body.mfa_token, body: { code } })).status).toBe(200);
      const replay = await call(ctx, "post", "/admin/auth/mfa/verify", { token: login.body.mfa_token, body: { code } });
      expect(replay.status).toBe(401);
    });

    it("wrong password, unknown email and deactivated account are indistinguishable 401s", async () => {
      const a = await createAdmin(ctx, ["AUDITOR"]);
      const dead = await createAdmin(ctx, ["AUDITOR"]);
      await ctx.pool.query("update admin_users set status = 'DEACTIVATED' where id = $1", [dead.id]);
      const responses = [
        await call(ctx, "post", "/admin/auth/login", { body: { email: a.email, password: "wrong-password" } }),
        await call(ctx, "post", "/admin/auth/login", { body: { email: "nobody@example.test", password: "wrong-password" } }),
        await call(ctx, "post", "/admin/auth/login", { body: { email: dead.email, password: dead.password } }),
      ];
      for (const r of responses) expect(r.status).toBe(401);
      expect(new Set(responses.map((r) => r.body.message)).size).toBe(1);
      expect((await call(ctx, "post", "/admin/auth/login", { body: { email: "not-an-email", password: "x" } })).status).toBe(400);
    });

    it("failed sign-ins are rate limited per email and per IP", async () => {
      const limited = await createTestContext({ ADMIN_LOGIN_LIMIT_PER_EMAIL_PER_15MIN: "3", ADMIN_LOGIN_LIMIT_PER_IP_PER_15MIN: "1000" });
      try {
        const email = `victim-${randomUUID().slice(0, 6)}@example.test`;
        const codes: number[] = [];
        for (let i = 0; i < 5; i++) codes.push((await call(limited, "post", "/admin/auth/login", { body: { email, password: "guess" } })).status);
        expect(codes).toEqual([401, 401, 401, 429, 429]);
      } finally {
        await limited.close();
      }
      const byIp = await createTestContext({ ADMIN_LOGIN_LIMIT_PER_IP_PER_15MIN: "2" });
      try {
        const ip = freshIp();
        const codes: number[] = [];
        for (let i = 0; i < 3; i++) codes.push((await call(byIp, "post", "/admin/auth/login", { ip, body: { email: `e${i}@example.test`, password: "guess" } })).status);
        expect(codes).toEqual([401, 401, 429]);
      } finally {
        await byIp.close();
      }
    });

    it("MFA guessing is locked out after the attempt cap, even with the right code afterwards", async () => {
      const limited = await createTestContext({ ADMIN_MFA_MAX_ATTEMPTS_PER_15MIN: "3" });
      try {
        const a = await createAdmin(limited, ["AUDITOR"]);
        const login = await call(limited, "post", "/admin/auth/login", { body: { email: a.email, password: a.password } });
        const results: number[] = [];
        for (let i = 0; i < 3; i++) results.push((await call(limited, "post", "/admin/auth/mfa/verify", { token: login.body.mfa_token, body: { code: "000000" } })).status);
        results.push((await call(limited, "post", "/admin/auth/mfa/verify", { token: login.body.mfa_token, body: { code: authenticator.generate(a.totpSecret) } })).status);
        expect(results).toEqual([401, 401, 401, 429]);
      } finally {
        await limited.close();
      }
    });

    it("recovery codes work once each", async () => {
      const a = await createAdmin(ctx, ["AUDITOR"], { enrolled: false });
      const l1 = await call(ctx, "post", "/admin/auth/login", { body: { email: a.email, password: a.password } });
      const enrol = await call(ctx, "post", "/admin/auth/mfa/enrol", { token: l1.body.mfa_token });
      await call(ctx, "post", "/admin/auth/mfa/confirm", { token: l1.body.mfa_token, body: { code: authenticator.generate(enrol.body.secret) } });
      const l2 = await call(ctx, "post", "/admin/auth/login", { body: { email: a.email, password: a.password } });
      const code = enrol.body.recovery_codes[0] as string;
      expect((await call(ctx, "post", "/admin/auth/mfa/recovery", { token: l2.body.mfa_token, body: { recovery_code: code.toLowerCase() } })).status).toBe(200);
      expect((await call(ctx, "post", "/admin/auth/mfa/recovery", { token: l2.body.mfa_token, body: { recovery_code: code } })).status).toBe(401);
      expect((await call(ctx, "post", "/admin/auth/mfa/recovery", { token: l2.body.mfa_token, body: { recovery_code: "AAAAA-AAAAA" } })).status).toBe(401);
    });

    it("token kinds are not interchangeable across the API", async () => {
      const a = await createAdmin(ctx, ["SUPER_ADMIN"]);
      const login = await call(ctx, "post", "/admin/auth/login", { body: { email: a.email, password: a.password } });
      const rider = await signUp(ctx, "RIDER");
      const session = await adminSession(ctx, a);
      // MFA token is not a session; a rider/driver access token is not an admin session
      expect((await call(ctx, "get", "/admin/riders", { token: login.body.mfa_token })).status).toBe(401);
      expect((await call(ctx, "get", "/admin/riders", { token: rider.token })).status).toBe(401);
      expect((await call(ctx, "get", "/admin/riders")).status).toBe(401);
      // an admin session is not a rider/driver token, nor an MFA token
      expect((await call(ctx, "get", "/me", { token: session })).status).toBe(401);
      expect((await call(ctx, "post", "/admin/auth/mfa/enrol", { token: session })).status).toBe(401);
      expect((await call(ctx, "post", "/admin/auth/mfa/enrol", { token: rider.token })).status).toBe(401);
    });

    it("a session without completed MFA, an expired, a revoked one, and a deactivated admin are all refused", async () => {
      const a = await createAdmin(ctx, ["SUPER_ADMIN"]);
      const t = await adminSession(ctx, a);
      expect((await call(ctx, "get", "/admin/riders", { token: t })).status).toBe(200);
      await ctx.pool.query("update admin_sessions set mfa_verified_at = null where admin_id = $1", [a.id]);
      expect((await call(ctx, "get", "/admin/riders", { token: t })).status).toBe(401);
      await ctx.pool.query("update admin_sessions set mfa_verified_at = now(), expires_at = now() - interval '1 second' where admin_id = $1", [a.id]);
      expect((await call(ctx, "get", "/admin/riders", { token: t })).status).toBe(401);
      await ctx.pool.query("update admin_sessions set expires_at = now() + interval '1 hour', revoked_at = now() where admin_id = $1", [a.id]);
      expect((await call(ctx, "get", "/admin/riders", { token: t })).status).toBe(401);
      await ctx.pool.query("update admin_sessions set revoked_at = null where admin_id = $1", [a.id]);
      expect((await call(ctx, "get", "/admin/riders", { token: t })).status).toBe(200);
      await ctx.pool.query("update admin_users set status = 'DEACTIVATED' where id = $1", [a.id]);
      expect((await call(ctx, "get", "/admin/riders", { token: t })).status).toBe(401);
    });

    it("logout revokes the admin session server-side", async () => {
      const a = await adminWith(ctx, ["AUDITOR"]);
      expect((await call(ctx, "post", "/admin/auth/logout", { token: a.token })).status).toBe(204);
      expect((await call(ctx, "get", "/admin/riders", { token: a.token })).status).toBe(401);
      expect((await call(ctx, "post", "/admin/auth/logout", { token: a.token })).status).toBe(401);
    });

    it("the idle window slides forward with use", async () => {
      const a = await createAdmin(ctx, ["AUDITOR"]);
      const t = await adminSession(ctx, a); // 1 h left, idle window is 8 h
      await call(ctx, "get", "/admin/riders", { token: t });
      const left = await ctx.pool.query("select extract(epoch from (expires_at - now()))::int as s from admin_sessions where admin_id = $1", [a.id]);
      expect(left.rows[0].s).toBeGreaterThan(7 * 3600);
    });
  });

  describe("roles and permissions (matrix from docs/phase-1/03_Admin_Console.md §2)", () => {
    // Which of the Phase 4 permissions each role holds, per the Phase 1 screen matrix (A-06/07/08/28
    // and the separate block permission). SUPPORT/SAFETY are scoped ("S") and need Phase 9 data.
    const ROLES: Record<string, { riders: boolean; drivers: boolean; approvals: boolean; audit: boolean; block: boolean; genderRider: boolean; manage: boolean; review: boolean; docs: boolean }> = {
      SUPER_ADMIN:    { riders: true,  drivers: true,  approvals: true,  audit: true,  block: true,  genderRider: true,  manage: true,  review: true,  docs: true },
      DRIVER_REVIEWER:{ riders: false, drivers: true,  approvals: true,  audit: false, block: false, genderRider: false, manage: true,  review: true,  docs: true },
      OPERATIONS:     { riders: true,  drivers: true,  approvals: false, audit: false, block: true,  genderRider: false, manage: false, review: false, docs: false },
      PRICING:        { riders: false, drivers: false, approvals: false, audit: false, block: false, genderRider: false, manage: false, review: false, docs: false },
      SUPPORT:        { riders: false, drivers: false, approvals: false, audit: false, block: false, genderRider: false, manage: false, review: false, docs: false },
      SAFETY:         { riders: false, drivers: false, approvals: false, audit: false, block: false, genderRider: false, manage: false, review: false, docs: false },
      FINANCE:        { riders: true,  drivers: true,  approvals: false, audit: false, block: false, genderRider: false, manage: false, review: false, docs: false },
      CONTENT_EDITOR: { riders: false, drivers: false, approvals: false, audit: false, block: false, genderRider: false, manage: false, review: false, docs: false },
      AUDITOR:        { riders: true,  drivers: true,  approvals: true,  audit: true,  block: false, genderRider: false, manage: false, review: false, docs: false },
    };
    const ghost = randomUUID();
    const body = { reason: "matrix probe" };

    for (const [role, can] of Object.entries(ROLES)) {
      it(`${role}: every route answers 403 or passes the permission check exactly as the matrix says`, async () => {
        const admin = await adminWith(ctx, [role]);
        const t = admin.token;
        // reads: 200 when allowed, 403 when not
        const reads: [string, string, boolean, Record<string, string>?][] = [
          ["/admin/riders", "riders", can.riders],
          ["/admin/drivers", "drivers", can.drivers],
          ["/admin/driver-approvals", "approvals", can.approvals],
          ["/admin/audit-log", "audit", can.audit],
        ];
        for (const [path, , allowed] of reads) {
          const r = await call(ctx, "get", path as never, { token: t });
          expect([path, r.status]).toEqual([path, allowed ? 200 : 403]);
        }
        // details and mutations against a non-existent id: 404 when the permission passes, 403 when not
        const probes: [string, "get" | "post" | "patch", string, boolean, unknown?][] = [
          ["get", "/admin/riders/{id}", "riders", can.riders] as never,
          ["get", "/admin/drivers/{id}", "drivers", can.drivers] as never,
          ["post", "/admin/riders/{id}/block", "block", can.block, { applies_to: ["RIDER"], reason: "matrix probe" }] as never,
          ["post", "/admin/riders/{id}/unblock", "block", can.block, body] as never,
          ["post", "/admin/drivers/{id}/block", "block", can.block, { applies_to: ["DRIVER"], reason: "matrix probe" }] as never,
          ["post", "/admin/drivers/{id}/unblock", "block", can.block, body] as never,
          ["post", "/admin/riders/{id}/gender-confirm", "genderRider", can.genderRider, { confirmed_gender: "FEMALE", reason: "matrix probe" }] as never,
          ["post", "/admin/drivers/{id}/gender-confirm", "manage", can.manage, { confirmed_gender: "FEMALE", reason: "matrix probe" }] as never,
          ["post", "/admin/drivers/{id}/suspend", "manage", can.manage, body] as never,
          ["post", "/admin/drivers/{id}/reinstate", "manage", can.manage, body] as never,
          ["patch", "/admin/drivers/{id}/categories", "manage", can.manage, { category_id: ghost, status: "APPROVED", reason: "matrix probe" }] as never,
          ["post", "/admin/driver-approvals/{id}/approve", "review", can.review, body] as never,
          ["post", "/admin/driver-approvals/{id}/reject", "review", can.review, body] as never,
          ["post", "/admin/driver-approvals/{id}/documents/{documentId}/approve", "review", can.review, body] as never,
          ["post", "/admin/driver-approvals/{id}/documents/{documentId}/reject", "review", can.review, body] as never,
          ["post", "/admin/driver-approvals/{id}/documents/{documentId}/request-changes", "review", can.review, body] as never,
          ["get", "/admin/driver-approvals/{id}/documents/{documentId}/download", "docs", can.docs] as never,
        ];
        for (const [method, path, , allowed, b] of probes) {
          const r = await call(ctx, method as "get", path, { token: t, params: { id: ghost, documentId: ghost }, body: b });
          expect([method, path, r.status]).toEqual([method, path, allowed ? 404 : 403]);
          if (!allowed) expect(r.body.code).toBe("NOT_AUTHORIZED");
        }
      });
    }

    it("a denied request leaves no trace in the data it protects", async () => {
      const auditor = await adminWith(ctx, ["AUDITOR"]);
      const s = await onboardDriver(ctx);
      const before = await ctx.pool.query("select status from driver_profiles where account_id = $1", [s.driver.accountId]);
      const r = await call(ctx, "post", "/admin/driver-approvals/{id}/reject", { token: auditor.token, params: { id: s.driver.accountId }, body: { reason: "attempt by auditor" } });
      expect(r.status).toBe(403);
      const after = await ctx.pool.query("select status from driver_profiles where account_id = $1", [s.driver.accountId]);
      expect(after.rows[0].status).toBe(before.rows[0].status);
      const audit = await ctx.pool.query("select count(*)::int as n from admin_audit_log where admin_id = $1", [auditor.id]);
      expect(audit.rows[0].n).toBe(0);
    });

    it("role changes take effect on the next request", async () => {
      const a = await adminWith(ctx, ["AUDITOR"]);
      expect((await call(ctx, "get", "/admin/riders", { token: a.token })).status).toBe(200);
      await ctx.pool.query("delete from admin_user_roles where admin_id = $1", [a.id]);
      expect((await call(ctx, "get", "/admin/riders", { token: a.token })).status).toBe(403);
    });

    it("the audit log is readable only with audit.read", async () => {
      const denied = await adminWith(ctx, ["DRIVER_REVIEWER"]);
      expect((await call(ctx, "get", "/admin/audit-log", { token: denied.token })).status).toBe(403);
    });
  });

  describe("audit log", () => {
    it("every driver decision records actor, roles, reason, before/after, ip and correlation id", async () => {
      const reviewer = await adminWith(ctx, ["DRIVER_REVIEWER"]);
      const s = await onboardDriver(ctx);
      const id = s.driver.accountId;
      await approveDriverViaApi(ctx, reviewer, id);
      await call(ctx, "post", "/admin/drivers/{id}/suspend", { token: reviewer.token, params: { id }, body: { reason: "pending complaint review" } });
      await call(ctx, "post", "/admin/drivers/{id}/reinstate", { token: reviewer.token, params: { id }, body: { reason: "complaint dismissed" } });

      const rows = await ctx.pool.query("select * from admin_audit_log where admin_id = $1 order by id", [reviewer.id]);
      const actions = rows.rows.map((r) => r.action);
      expect(actions).toEqual(expect.arrayContaining(["driver_document.approve", "driver.approve", "driver.suspend", "driver.reinstate"]));
      const suspend = rows.rows.find((r) => r.action === "driver.suspend");
      expect(suspend).toMatchObject({ target_type: "driver", target_id: id, reason: "pending complaint review", actor_roles: ["DRIVER_REVIEWER"] });
      expect(suspend.before_state).toEqual({ status: "APPROVED" });
      expect(suspend.after_state).toEqual({ status: "SUSPENDED" });
      expect(suspend.correlation_id).toMatch(/^[0-9a-f-]{36}$/);
      expect(suspend.ip).toBeTruthy();
      const approve = rows.rows.find((r) => r.action === "driver.approve");
      expect(approve.after_state.categories_approved).toEqual([s.categoryId]);
    });

    it("rejected or invalid actions write no audit row", async () => {
      const reviewer = await adminWith(ctx, ["DRIVER_REVIEWER"]);
      const s = await onboardDriver(ctx);
      const id = s.driver.accountId;
      await call(ctx, "post", "/admin/driver-approvals/{id}/approve", { token: reviewer.token, params: { id }, body: { reason: "premature" } }); // 409
      await call(ctx, "post", "/admin/drivers/{id}/suspend", { token: reviewer.token, params: { id }, body: { reason: "not approved" } }); // 409
      await call(ctx, "post", "/admin/drivers/{id}/suspend", { token: reviewer.token, params: { id }, body: { reason: "x" } }); // 400
      const n = await ctx.pool.query("select count(*)::int as n from admin_audit_log where admin_id = $1", [reviewer.id]);
      expect(n.rows[0].n).toBe(0);
    });

    it("the action and its audit row commit together: if the audit insert fails the action is rolled back", async () => {
      const reviewer = await adminWith(ctx, ["DRIVER_REVIEWER"]);
      const s = await onboardDriver(ctx);
      await approveDriverViaApi(ctx, reviewer, s.driver.accountId);
      await ctx.pool.query("alter table admin_audit_log add constraint fail_suspend check (action <> 'driver.suspend') not valid");
      try {
        // not via call(): a 500 is deliberately outside the contract's declared responses for this route
        const r = await request(ctx.url)
          .post(`/v1/admin/drivers/${s.driver.accountId}/suspend`)
          .set("X-Forwarded-For", freshIp())
          .set("Authorization", `Bearer ${reviewer.token}`)
          .send({ reason: "will not be recorded" });
        expect(r.status).toBe(500);
        expect(r.body.code).toBe("INTERNAL_ERROR");
        const st = await ctx.pool.query("select status from driver_profiles where account_id = $1", [s.driver.accountId]);
        expect(st.rows[0].status).toBe("APPROVED");
      } finally {
        await ctx.pool.query("alter table admin_audit_log drop constraint fail_suspend");
      }
    });

    it("audit rows cannot be edited or deleted, even by SQL", async () => {
      await expect(ctx.pool.query("update admin_audit_log set reason = 'tampered'")).rejects.toThrow(/append-only/);
      await expect(ctx.pool.query("delete from admin_audit_log")).rejects.toThrow(/append-only/);
    });

    it("the audit-log endpoint filters, paginates and never shows a page twice", async () => {
      const auditor = await adminWith(ctx, ["SUPER_ADMIN"]);
      const s = await onboardDriver(ctx);
      const id = s.driver.accountId;
      await approveDriverViaApi(ctx, auditor, id);
      const byTarget = await call(ctx, "get", "/admin/audit-log", { token: auditor.token, query: { target_type: "driver", target_id: id } });
      expect(byTarget.status).toBe(200);
      expect(byTarget.body.items.every((e: { target_id: string }) => e.target_id === id)).toBe(true);
      expect(byTarget.body.items[0]).toMatchObject({ action: "driver.approve", admin_name: "Test Admin" });

      const p1 = await call(ctx, "get", "/admin/audit-log", { token: auditor.token, query: { admin_id: auditor.id, limit: 2 } });
      expect(p1.body.items).toHaveLength(2);
      expect(p1.body.next_cursor).toBeTruthy();
      const p2 = await call(ctx, "get", "/admin/audit-log", { token: auditor.token, query: { admin_id: auditor.id, limit: 2, cursor: p1.body.next_cursor } });
      const ids = [...p1.body.items, ...p2.body.items].map((e: { id: number }) => e.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect((await call(ctx, "get", "/admin/audit-log", { token: auditor.token, query: { from: "not-a-date" } })).status).toBe(400);
      expect((await call(ctx, "get", "/admin/audit-log", { token: auditor.token, query: { action: "no.such.action" } })).body.items).toEqual([]);
    });
  });

  describe("driver documents (private, audited)", () => {
    it("a reviewer gets a short-lived signed URL to the real bytes; every open is audited; others get nothing", async () => {
      const reviewer = await adminWith(ctx, ["DRIVER_REVIEWER"]);
      const s = await onboardDriver(ctx, { submit: false });
      const t = s.driver.token;
      const docs = (await call(ctx, "get", "/driver/documents", { token: t })).body as { id: string }[];
      const doc = docs[0]!;

      const dl = await call(ctx, "get", "/admin/driver-approvals/{id}/documents/{documentId}/download", { token: reviewer.token, params: { id: s.driver.accountId, documentId: doc.id } });
      expect(dl.status).toBe(200);
      expect(new Date(dl.body.expires_at).getTime() - Date.now()).toBeLessThanOrEqual(120_000);
      const bytes = Buffer.from(await (await fetch(dl.body.url)).arrayBuffer());
      expect([JPEG.length, PNG.length]).toContain(bytes.length);

      const log = await ctx.pool.query("select * from admin_audit_log where admin_id = $1 and action = 'driver_document.view'", [reviewer.id]);
      expect(log.rows).toHaveLength(1);
      expect(log.rows[0]).toMatchObject({ target_type: "driver_document", target_id: doc.id });
      await call(ctx, "get", "/admin/driver-approvals/{id}/documents/{documentId}/download", { token: reviewer.token, params: { id: s.driver.accountId, documentId: doc.id } });
      expect((await ctx.pool.query("select count(*)::int as n from admin_audit_log where admin_id = $1 and action = 'driver_document.view'", [reviewer.id])).rows[0].n).toBe(2);

      const auditor = await adminWith(ctx, ["AUDITOR"]);
      const denied = await call(ctx, "get", "/admin/driver-approvals/{id}/documents/{documentId}/download", { token: auditor.token, params: { id: s.driver.accountId, documentId: doc.id } });
      expect(denied.status).toBe(403);
      expect((await ctx.pool.query("select count(*)::int as n from admin_audit_log where admin_id = $1", [auditor.id])).rows[0].n).toBe(0);

      const wrongDriver = await onboardDriver(ctx, { submit: false });
      const mismatch = await call(ctx, "get", "/admin/driver-approvals/{id}/documents/{documentId}/download", { token: reviewer.token, params: { id: wrongDriver.driver.accountId, documentId: doc.id } });
      expect(mismatch.status).toBe(404); // a document id only resolves under its own driver
    });

    it("a driver cannot reach the admin download route or another driver's documents", async () => {
      const a = await onboardDriver(ctx, { submit: false });
      const b = await signUp(ctx, "DRIVER");
      const docs = (await call(ctx, "get", "/driver/documents", { token: a.driver.token })).body as { id: string }[];
      expect((await call(ctx, "get", "/admin/driver-approvals/{id}/documents/{documentId}/download", { token: b.token, params: { id: a.driver.accountId, documentId: docs[0]!.id } })).status).toBe(401);
      expect((await call(ctx, "get", "/driver/documents", { token: b.token })).body).toEqual([]);
    });
  });

  describe("blocks (D-34, D-41)", () => {
    it("blocks and unblocks a rider: sessions revoked, sign-in refused with ACCOUNT_BLOCKED, then allowed again", async () => {
      const ops = await adminWith(ctx, ["OPERATIONS"]);
      const rider = await signUp(ctx, "RIDER");
      const r = await call(ctx, "post", "/admin/riders/{id}/block", { token: ops.token, params: { id: rider.accountId }, body: { applies_to: ["RIDER"], reason: "abusive behaviour reports" } });
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ applied: true, pending_until_trip_end: false });
      expect((await call(ctx, "get", "/me", { token: rider.token })).status).toBe(401);
      expect((await call(ctx, "post", "/auth/token/refresh", { body: { refresh_token: rider.refresh } })).status).toBe(401);

      const { challengeId, code } = await requestCode(ctx, rider.phone, "RIDER");
      const v = await call(ctx, "post", "/auth/otp/verify", { body: { challenge_id: challengeId, code } });
      expect(v.status).toBe(403);
      expect(v.body.code).toBe("ACCOUNT_BLOCKED");

      const list = await call(ctx, "get", "/admin/riders", { token: ops.token, query: { q: rider.phone } });
      expect(list.body.items[0]).toMatchObject({ id: rider.accountId, blocked: true, block_pending: false });

      expect((await call(ctx, "post", "/admin/riders/{id}/unblock", { token: ops.token, params: { id: rider.accountId }, body: { reason: "appeal accepted" } })).status).toBe(200);
      const again = await signIn(ctx, rider.phone, "RIDER");
      expect((await call(ctx, "get", "/me", { token: again.token })).status).toBe(200);
      const log = await ctx.pool.query("select action, reason from admin_audit_log where target_id = $1 order by id", [rider.accountId]);
      expect(log.rows).toEqual([
        { action: "account.block", reason: "abusive behaviour reports" },
        { action: "account.unblock", reason: "appeal accepted" },
      ]);
    });

    it("a block during an active trip is queued: the rider keeps the session until the trip ends, then it applies", async () => {
      const ops = await adminWith(ctx, ["OPERATIONS"]);
      const rider = await signUp(ctx, "RIDER");
      const cat = await createCategory(ctx);
      await createRide(ctx, rider.accountId, cat, "IN_PROGRESS");
      const r = await call(ctx, "post", "/admin/riders/{id}/block", { token: ops.token, params: { id: rider.accountId }, body: { applies_to: ["RIDER"], reason: "reported during trip" } });
      expect(r.body).toMatchObject({ applied: false, pending_until_trip_end: true, effective_at: null });
      expect((await call(ctx, "get", "/me", { token: rider.token })).status).toBe(200); // trip is never interrupted
      const list = await call(ctx, "get", "/admin/riders", { token: ops.token, query: { q: rider.phone } });
      expect(list.body.items[0]).toMatchObject({ blocked: false, block_pending: true });

      const dup = await call(ctx, "post", "/admin/riders/{id}/block", { token: ops.token, params: { id: rider.accountId }, body: { applies_to: ["RIDER"], reason: "same again" } });
      expect(dup.body.pending_until_trip_end).toBe(true);
      expect((await ctx.pool.query("select count(*)::int as n from account_blocks where account_id = $1", [rider.accountId])).rows[0].n).toBe(1);

      // the ride-terminal hook (Phase 7) calls this in the transaction that ends the trip
      const { PeopleService } = await import("../src/modules/admin/people.service");
      const people = ctx.app.get(PeopleService);
      await ctx.pool.query("update rides set status = 'COMPLETED' where rider_id = $1", [rider.accountId]);
      const { DB } = await import("../src/db/db.module");
      const applied = await ctx.app.get(DB).transaction().execute((trx: never) => people.applyPendingBlocks(trx, rider.accountId));
      expect(applied).toBe(1);
      expect((await call(ctx, "get", "/me", { token: rider.token })).status).toBe(401);
      const eff = await call(ctx, "get", "/admin/riders", { token: ops.token, query: { q: rider.phone } });
      expect(eff.body.items[0]).toMatchObject({ blocked: true, block_pending: false });
    });

    it("a driver with an open assignment is treated the same way", async () => {
      const ops = await adminWith(ctx, ["OPERATIONS"]);
      const reviewer = await adminWith(ctx, ["DRIVER_REVIEWER"]);
      const s = await onboardDriver(ctx);
      await approveDriverViaApi(ctx, reviewer, s.driver.accountId);
      const rider = await signUp(ctx, "RIDER");
      const ride = await createRide(ctx, rider.accountId, s.categoryId, "CONFIRMED");
      const vehicle = (await ctx.pool.query("select current_vehicle_id as v from driver_profiles where account_id = $1", [s.driver.accountId])).rows[0].v;
      const offer = (await ctx.pool.query(
        `insert into ride_offers (ride_id, driver_id, vehicle_id, attempt_no, driver_attempt_no, ack_deadline_at, state, resolved_at, end_reason, acknowledged_at, accept_deadline_at)
         values ($1,$2,$3,1,1, now(), 'ACCEPTED', now(), 'ACCEPTED', now(), now() + interval '3 seconds') returning id`,
        [ride, s.driver.accountId, vehicle],
      )).rows[0].id;
      await ctx.pool.query("insert into ride_assignments (ride_id, driver_id, vehicle_id, offer_id, vehicle_snapshot) values ($1,$2,$3,$4,'{}')", [ride, s.driver.accountId, vehicle, offer]);

      const r = await call(ctx, "post", "/admin/drivers/{id}/block", { token: ops.token, params: { id: s.driver.accountId }, body: { applies_to: ["DRIVER"], reason: "reported during trip" } });
      expect(r.body).toMatchObject({ applied: false, pending_until_trip_end: true });
      expect((await call(ctx, "get", "/driver/onboarding/status", { token: s.driver.token })).status).toBe(200);
      const st = await ctx.pool.query("select driver_ineligibility_reasons($1,$2) as r", [s.driver.accountId, s.categoryId]);
      expect(st.rows[0].r).toContain("BLOCK_PENDING"); // no NEW offers while the block is pending
    });

    it("concurrent blocks of one account create exactly one block; unblock lifts it", async () => {
      const ops = await adminWith(ctx, ["OPERATIONS"]);
      const rider = await signUp(ctx, "RIDER");
      const results = await Promise.all(
        [1, 2, 3, 4, 5].map((i) => call(ctx, "post", "/admin/riders/{id}/block", { token: ops.token, params: { id: rider.accountId }, body: { applies_to: ["RIDER"], reason: `race ${i}` } })),
      );
      expect(results.every((r) => r.status === 200)).toBe(true);
      expect((await ctx.pool.query("select count(*)::int as n from account_blocks where account_id = $1 and lifted_at is null", [rider.accountId])).rows[0].n).toBe(1);
      expect((await ctx.pool.query("select count(*)::int as n from admin_audit_log where target_id = $1 and action = 'account.block'", [rider.accountId])).rows[0].n).toBe(1);
      await call(ctx, "post", "/admin/riders/{id}/unblock", { token: ops.token, params: { id: rider.accountId }, body: { reason: "cleared after review" } });
      expect((await ctx.pool.query("select count(*)::int as n from account_blocks where account_id = $1 and lifted_at is null", [rider.accountId])).rows[0].n).toBe(0);
      // unblocking an account that is not blocked changes nothing and logs nothing
      await call(ctx, "post", "/admin/riders/{id}/unblock", { token: ops.token, params: { id: rider.accountId }, body: { reason: "nothing to lift" } });
      expect((await ctx.pool.query("select count(*)::int as n from admin_audit_log where target_id = $1 and action = 'account.unblock'", [rider.accountId])).rows[0].n).toBe(1);
    });

    it("blocking needs a reason and a real account of the right kind", async () => {
      const ops = await adminWith(ctx, ["OPERATIONS"]);
      const rider = await signUp(ctx, "RIDER");
      expect((await call(ctx, "post", "/admin/riders/{id}/block", { token: ops.token, params: { id: rider.accountId }, body: { applies_to: ["RIDER"], reason: "x" } })).status).toBe(400);
      expect((await call(ctx, "post", "/admin/riders/{id}/block", { token: ops.token, params: { id: rider.accountId }, body: { applies_to: [], reason: "valid reason" } })).status).toBe(400);
      expect((await call(ctx, "post", "/admin/drivers/{id}/block", { token: ops.token, params: { id: rider.accountId }, body: { applies_to: ["DRIVER"], reason: "not a driver" } })).status).toBe(404);
      expect((await call(ctx, "post", "/admin/riders/{id}/block", { token: ops.token, params: { id: "not-a-uuid" }, body: { applies_to: ["RIDER"], reason: "valid reason" } })).status).toBe(400);
    });
  });

  describe("concurrency of review decisions", () => {
    it("three reviewers approving the same application at once: exactly one wins, one audit row", async () => {
      const [a, b, c] = await Promise.all([adminWith(ctx, ["DRIVER_REVIEWER"]), adminWith(ctx, ["DRIVER_REVIEWER"]), adminWith(ctx, ["DRIVER_REVIEWER"])]);
      const s = await onboardDriver(ctx);
      const id = s.driver.accountId;
      const docs = (await call(ctx, "get", "/driver/documents", { token: s.driver.token })).body as { id: string }[];
      for (const d of docs) await call(ctx, "post", "/admin/driver-approvals/{id}/documents/{documentId}/approve", { token: a.token, params: { id, documentId: d.id }, body: { reason: "documents ok" } });
      const results = await Promise.all([a, b, c].map((x) => call(ctx, "post", "/admin/driver-approvals/{id}/approve", { token: x.token, params: { id }, body: { reason: "verified" } })));
      expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
      expect((await ctx.pool.query("select count(*)::int as n from admin_audit_log where target_id = $1 and action = 'driver.approve'", [id])).rows[0].n).toBe(1);
    });

    it("approve racing reject: one outcome, consistent state", async () => {
      const a = await adminWith(ctx, ["DRIVER_REVIEWER"]);
      const s = await onboardDriver(ctx);
      const id = s.driver.accountId;
      const docs = (await call(ctx, "get", "/driver/documents", { token: s.driver.token })).body as { id: string }[];
      for (const d of docs) await call(ctx, "post", "/admin/driver-approvals/{id}/documents/{documentId}/approve", { token: a.token, params: { id, documentId: d.id }, body: { reason: "documents ok" } });
      const [ap, rj] = await Promise.all([
        call(ctx, "post", "/admin/driver-approvals/{id}/approve", { token: a.token, params: { id }, body: { reason: "verified" } }),
        call(ctx, "post", "/admin/driver-approvals/{id}/reject", { token: a.token, params: { id }, body: { reason: "changed our mind" } }),
      ]);
      expect([ap.status, rj.status].sort()).toEqual([200, 409]);
      const st = (await ctx.pool.query("select status from driver_profiles where account_id = $1", [id])).rows[0].status;
      expect(st).toBe(ap.status === 200 ? "APPROVED" : "REJECTED");
      const cats = (await ctx.pool.query("select status from driver_category_approvals where driver_id = $1", [id])).rows;
      expect(cats.every((c) => c.status === (st === "APPROVED" ? "APPROVED" : "REJECTED"))).toBe(true);
    });

    it("a driver replacing a document while the reviewer decides on it never leaves two current documents", async () => {
      const a = await adminWith(ctx, ["DRIVER_REVIEWER"]);
      const s = await onboardDriver(ctx);
      const id = s.driver.accountId;
      const docs = (await call(ctx, "get", "/driver/documents", { token: s.driver.token })).body as { id: string; document_type_id: string }[];
      const target = docs.find((d) => d.document_type_id === s.docTypeIds[0])!;
      const up = await uploadFile(ctx, s.driver.token, JPEG);
      await Promise.all([
        call(ctx, "post", "/admin/driver-approvals/{id}/documents/{documentId}/approve", { token: a.token, params: { id, documentId: target.id }, body: { reason: "documents ok" } }),
        call(ctx, "post", "/driver/onboarding/documents", { token: s.driver.token, body: { document_type_id: s.docTypeIds[0], upload_id: up.uploadId } }),
      ]);
      const current = await ctx.pool.query("select count(*)::int as n from driver_documents where driver_id = $1 and document_type_id = $2 and status in ('UPLOADED','APPROVED','NEEDS_CHANGES')", [id, s.docTypeIds[0]]);
      expect(current.rows[0].n).toBe(1);
    });
  });

  describe("riders and drivers lists", () => {
    it("list, search, paginate without skipping or repeating; detail shows gender confirmation state", async () => {
      const admin = await adminWith(ctx, ["SUPER_ADMIN"]);
      const phones = [randomPhone(), randomPhone(), randomPhone()];
      const riders = [];
      for (const p of phones) riders.push(await signUp(ctx, "RIDER", { phone: p, gender: "FEMALE" }));

      const seen: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await call(ctx, "get", "/admin/riders", { token: admin.token, query: { limit: 2, cursor } });
        expect(page.status).toBe(200);
        seen.push(...page.body.items.map((i: { id: string }) => i.id));
        cursor = page.body.next_cursor ?? undefined;
      } while (cursor);
      expect(new Set(seen).size).toBe(seen.length);
      for (const r of riders) expect(seen).toContain(r.accountId);

      const found = await call(ctx, "get", "/admin/riders", { token: admin.token, query: { q: phones[1] } });
      expect(found.body.items.map((i: { id: string }) => i.id)).toEqual([riders[1]!.accountId]);
      expect(found.body.items[0]).toMatchObject({ declared_gender: "FEMALE", gender_confirmed: false, trip_count: 0, blocked: false });
      const detail = await call(ctx, "get", "/admin/riders/{id}", { token: admin.token, params: { id: riders[0]!.accountId } });
      expect(detail.body.recent_rides).toEqual([]);
      expect((await call(ctx, "get", "/admin/riders/{id}", { token: admin.token, params: { id: randomUUID() } })).status).toBe(404);
      const wildcard = await call(ctx, "get", "/admin/riders", { token: admin.token, query: { q: "%" } });
      expect(wildcard.body.items).toEqual([]); // LIKE metacharacters are escaped
    });

    it("gender confirmation for a rider needs a completed ride, a reason, and is audited (D-39)", async () => {
      const admin = await adminWith(ctx, ["SUPER_ADMIN"]);
      const rider = await signUp(ctx, "RIDER", { gender: "FEMALE" });
      const body = { confirmed_gender: "FEMALE", reason: "matched ID at first ride" };
      const early = await call(ctx, "post", "/admin/riders/{id}/gender-confirm", { token: admin.token, params: { id: rider.accountId }, body });
      expect(early.status).toBe(409);
      const cat = await createCategory(ctx);
      await createRide(ctx, rider.accountId, cat, "COMPLETED");
      expect((await call(ctx, "post", "/admin/riders/{id}/gender-confirm", { token: admin.token, params: { id: rider.accountId }, body: { ...body, reason: "" } })).status).toBe(400);
      expect((await call(ctx, "post", "/admin/riders/{id}/gender-confirm", { token: admin.token, params: { id: rider.accountId }, body })).status).toBe(200);
      const me = await call(ctx, "get", "/me", { token: rider.token });
      expect(me.body.gender_confirmed).toBe(true);
      const log = await ctx.pool.query("select before_state, after_state from admin_audit_log where target_id = $1 and action = 'rider.gender_confirm'", [rider.accountId]);
      expect(log.rows[0].before_state).toEqual({ gender: "FEMALE", confirmed: false });
      expect(log.rows[0].after_state).toEqual({ gender: "FEMALE", confirmed: true });
      const detail = await call(ctx, "get", "/admin/riders/{id}", { token: admin.token, params: { id: rider.accountId } });
      expect(detail.body).toMatchObject({ gender_confirmed: true, trip_count: 1 });
    });

    it("drivers list shows status, plate, qualified categories and document status", async () => {
      const admin = await adminWith(ctx, ["OPERATIONS"]);
      const reviewer = await adminWith(ctx, ["DRIVER_REVIEWER"]);
      const s = await onboardDriver(ctx);
      await approveDriverViaApi(ctx, reviewer, s.driver.accountId);
      const plate = (await ctx.pool.query("select plate from vehicles where driver_id = $1", [s.driver.accountId])).rows[0].plate;
      const list = await call(ctx, "get", "/admin/drivers", { token: admin.token, query: { q: plate } });
      expect(list.body.items).toHaveLength(1);
      expect(list.body.items[0]).toMatchObject({ id: s.driver.accountId, status: "APPROVED", vehicle_plate: plate, document_status: "COMPLETE", blocked: false, wallet_balances: [] });
      expect(list.body.items[0].qualified_categories).toHaveLength(1);
      const detail = await call(ctx, "get", "/admin/drivers/{id}", { token: admin.token, params: { id: s.driver.accountId } });
      expect(detail.body.vehicles).toHaveLength(1);
      expect(detail.body.documents).toHaveLength(2);
    });
  });
});
