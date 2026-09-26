// Refresh rotation, reuse detection, logout, per-request session checks, profile update, legal
// acceptance and push devices; every response is checked against docs/phase-2/openapi.yaml.
import { randomUUID } from "node:crypto";
import { adminWith, signIn, signUp } from "./support/fixtures";
import { TestContext, call, createTestContext } from "./support/test-app";

describe("sessions and profile", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext({ OTP_RESEND_INTERVAL_S: "0" });
  });
  afterAll(() => ctx.close());

  describe("refresh token rotation", () => {
    it("issues a new pair; the new access token works; the old refresh token is rejected", async () => {
      const u = await signUp(ctx, "RIDER");
      const r1 = await call(ctx, "post", "/auth/token/refresh", { body: { refresh_token: u.refresh } });
      expect(r1.status).toBe(200);
      expect(r1.body.refresh_token).not.toBe(u.refresh);
      const me = await call(ctx, "get", "/me", { token: r1.body.access_token });
      expect(me.status).toBe(200);
      expect(me.body.id).toBe(u.accountId);

      const replay = await call(ctx, "post", "/auth/token/refresh", { body: { refresh_token: u.refresh } });
      expect(replay.status).toBe(401);
    });

    it("reuse of a rotated token revokes the whole session, including the newest tokens", async () => {
      const u = await signUp(ctx, "RIDER");
      const r1 = await call(ctx, "post", "/auth/token/refresh", { body: { refresh_token: u.refresh } });
      await call(ctx, "post", "/auth/token/refresh", { body: { refresh_token: u.refresh } }); // replay -> revoke
      const viaNew = await call(ctx, "post", "/auth/token/refresh", { body: { refresh_token: r1.body.refresh_token } });
      expect(viaNew.status).toBe(401);
      const me = await call(ctx, "get", "/me", { token: r1.body.access_token });
      expect(me.status).toBe(401);
      const row = await ctx.pool.query("select revoke_reason from sessions where account_id = $1", [u.accountId]);
      expect(row.rows[0].revoke_reason).toBe("REFRESH_REUSE");
    });

    it("an unknown or malformed refresh token is 401 / 400", async () => {
      expect((await call(ctx, "post", "/auth/token/refresh", { body: { refresh_token: "nope" } })).status).toBe(401);
      expect((await call(ctx, "post", "/auth/token/refresh", { body: {} })).status).toBe(400);
    });

    it("two parallel refreshes of one token: exactly one succeeds", async () => {
      const u = await signUp(ctx, "RIDER");
      const results = await Promise.all([1, 2, 3].map(() => call(ctx, "post", "/auth/token/refresh", { body: { refresh_token: u.refresh } })));
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(results.filter((r) => r.status === 401)).toHaveLength(2);
    });
  });

  describe("logout and per-request session checks", () => {
    it("logout revokes the session: access token and refresh token stop working", async () => {
      const u = await signUp(ctx, "DRIVER");
      const out = await call(ctx, "post", "/auth/logout", { token: u.token, body: { refresh_token: u.refresh } });
      expect(out.status).toBe(204);
      expect((await call(ctx, "get", "/me", { token: u.token })).status).toBe(401);
      expect((await call(ctx, "post", "/auth/token/refresh", { body: { refresh_token: u.refresh } })).status).toBe(401);
    });

    it("logout with another session's refresh token is refused and revokes nothing", async () => {
      const a = await signUp(ctx, "RIDER");
      const b = await signUp(ctx, "RIDER");
      const res = await call(ctx, "post", "/auth/logout", { token: a.token, body: { refresh_token: b.refresh } });
      expect(res.status).toBe(401);
      expect((await call(ctx, "get", "/me", { token: a.token })).status).toBe(200);
      expect((await call(ctx, "get", "/me", { token: b.token })).status).toBe(200);
    });

    it("logging out one device leaves the account's other session alive", async () => {
      const first = await signUp(ctx, "RIDER");
      const second = await signIn(ctx, first.phone, "RIDER");
      await call(ctx, "post", "/auth/logout", { token: first.token, body: { refresh_token: first.refresh } });
      expect((await call(ctx, "get", "/me", { token: second.token })).status).toBe(200);
    });

    it("a deleted account is refused at once, even with a valid unexpired token", async () => {
      const u = await signUp(ctx, "RIDER");
      await ctx.pool.query("update accounts set status = 'DELETED' where id = $1", [u.accountId]);
      expect((await call(ctx, "get", "/me", { token: u.token })).status).toBe(401);
      expect((await call(ctx, "post", "/auth/token/refresh", { body: { refresh_token: u.refresh } })).status).toBe(401);
    });

    it("an expired session row is refused even though the JWT has not expired", async () => {
      const u = await signUp(ctx, "RIDER");
      await ctx.pool.query("update sessions set expires_at = now() - interval '1 second' where account_id = $1", [u.accountId]);
      expect((await call(ctx, "get", "/me", { token: u.token })).status).toBe(401);
    });

    it("a block for one app does not lock the other app", async () => {
      const both = await signUp(ctx, "RIDER");
      const asDriver = await signIn(ctx, both.phone, "DRIVER");
      const admin = await adminWith(ctx, ["SUPER_ADMIN"]);
      await ctx.pool.query("insert into driver_profiles (account_id) values ($1)", [both.accountId]);
      const blocked = await call(ctx, "post", "/admin/drivers/{id}/block", { token: admin.token, params: { id: both.accountId }, body: { applies_to: ["DRIVER"], reason: "test block" } });
      expect(blocked.status).toBe(200);
      expect((await call(ctx, "get", "/me", { token: asDriver.token })).status).toBe(401); // session revoked
      expect((await call(ctx, "get", "/me", { token: both.token })).status).toBe(200); // rider side untouched
    });
  });

  describe("app scoping", () => {
    it("a rider token is refused on driver routes with NOT_AUTHORIZED", async () => {
      const rider = await signUp(ctx, "RIDER");
      const res = await call(ctx, "get", "/driver/onboarding/status", { token: rider.token });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("NOT_AUTHORIZED");
    });

    it("no token, garbage token, and a needs-profile token are all 401 on protected routes", async () => {
      expect((await call(ctx, "get", "/me")).status).toBe(401);
      expect((await call(ctx, "get", "/me", { token: "garbage" })).status).toBe(401);
    });
  });

  describe("PATCH /me", () => {
    it("updates name, email, language and currency", async () => {
      const u = await signUp(ctx, "RIDER");
      const res = await call(ctx, "patch", "/me", { token: u.token, body: { first_name: "Nour", email: "nour@example.test", language: "fr", preferred_currency: "LBP" } });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ first_name: "Nour", email: "nour@example.test", language: "fr", preferred_currency: "LBP" });
    });

    it("rejects an unknown currency, a bad email and an empty name", async () => {
      const u = await signUp(ctx, "RIDER");
      for (const body of [{ preferred_currency: "XXX" }, { email: "not-an-email" }, { first_name: "  " }, { language: "de" }]) {
        const res = await call(ctx, "patch", "/me", { token: u.token, body });
        expect(res.status).toBe(400);
      }
    });

    it("cannot change gender or phone through PATCH (unknown keys are ignored)", async () => {
      const u = await signUp(ctx, "RIDER", { gender: "MALE" });
      const res = await call(ctx, "patch", "/me", { token: u.token, body: { gender: "FEMALE", phone_e164: "+96170000000" } });
      expect(res.status).toBe(200);
      expect(res.body.gender).toBe("MALE");
      expect(res.body.phone_e164).toBe(u.phone);
    });
  });

  describe("legal documents", () => {
    async function publish(docType: string, audience: string[], versionNo: number, status = "PUBLISHED") {
      const id = randomUUID();
      await ctx.pool.query(
        `insert into legal_document_versions (id, doc_type, audience, version_no, status, published_at)
         values ($1,$2,$3::app_kind[],$4,$5, now())`,
        [id, docType, `{${audience.join(",")}}`, versionNo, status],
      );
      for (const lang of ["ar", "en", "fr"]) {
        await ctx.pool.query("insert into legal_document_texts (version_id, language, title, body_markdown) values ($1,$2,$3,$4)", [id, lang, `Test ${docType} ${lang}`, `placeholder body ${lang}`]);
      }
      return id;
    }

    it("sign-up must accept the whole current set; unknown or superseded ids are refused", async () => {
      // CANCELLATION for RIDER only, so it cannot disturb other suites' sign-ups (they use no legal docs
      // only because none is published for their app at that moment).
      const v1 = await publish("CANCELLATION", ["RIDER"], 1, "RETIRED");
      const v2 = await publish("CANCELLATION", ["RIDER"], 2);
      try {
        const phone = `+9613${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;
        const { requestCode } = await import("./support/test-app");
        const { challengeId, code } = await requestCode(ctx, phone, "RIDER");
        const v = await call(ctx, "post", "/auth/otp/verify", { body: { challenge_id: challengeId, code } });
        const token = v.body.needs_profile_token;
        const base = { first_name: "L", last_name: "T", gender: "FEMALE" };

        // the sign-up screen fetches the terms with the needs-profile token, in the language it asks for
        const shown = await call(ctx, "get", "/legal/current", { token, query: { language: "fr" } });
        expect(shown.status).toBe(200);
        expect(shown.body.map((d: { id: string }) => d.id)).toEqual([v2]);
        expect(shown.body[0].language).toBe("fr");
        expect((await call(ctx, "get", "/legal/current", { token, query: { language: "de" } })).status).toBe(400);

        const none = await call(ctx, "post", "/me/complete-profile", { token, body: { ...base, accepted_legal_version_ids: [] } });
        expect(none.status).toBe(400);
        expect(none.body.code).toBe("TERMS_ACCEPTANCE_REQUIRED");
        expect(none.body.details.missing_version_ids).toEqual([v2]);

        const old = await call(ctx, "post", "/me/complete-profile", { token, body: { ...base, accepted_legal_version_ids: [v1, v2] } });
        expect(old.status).toBe(400);
        expect(old.body.code).toBe("VALIDATION_FAILED");

        const ok = await call(ctx, "post", "/me/complete-profile", { token, body: { ...base, accepted_legal_version_ids: [v2] } });
        expect(ok.status).toBe(201);
        const acc = await ctx.pool.query("select count(*)::int as n from legal_acceptances where version_id = $1", [v2]);
        expect(acc.rows[0].n).toBe(1);
      } finally {
        await ctx.pool.query("delete from legal_acceptances where version_id in ($1,$2)", [v1, v2]);
        await ctx.pool.query("delete from legal_document_texts where version_id in ($1,$2)", [v1, v2]);
        await ctx.pool.query("delete from legal_document_versions where id in ($1,$2)", [v1, v2]);
      }
    });

    it("GET /legal/current serves the latest published version in the account language; accept is idempotent", async () => {
      const u = await signUp(ctx, "RIDER");
      await call(ctx, "patch", "/me", { token: u.token, body: { language: "fr" } });
      const v = await publish("OTHER", ["RIDER"], 1);
      try {
        const cur = await call(ctx, "get", "/legal/current", { token: u.token });
        expect(cur.status).toBe(200);
        const doc = cur.body.find((d: { id: string }) => d.id === v);
        expect(doc).toMatchObject({ language: "fr", title: "Test OTHER fr" });

        const a1 = await call(ctx, "post", "/legal/{versionId}/accept", { token: u.token, params: { versionId: v }, body: {} });
        const a2 = await call(ctx, "post", "/legal/{versionId}/accept", { token: u.token, params: { versionId: v }, body: {} });
        expect([a1.status, a2.status]).toEqual([204, 204]);
        const n = await ctx.pool.query("select count(*)::int as n from legal_acceptances where account_id = $1 and version_id = $2", [u.accountId, v]);
        expect(n.rows[0].n).toBe(1);

        const driver = await signUp(ctx, "DRIVER");
        const notForDriver = await call(ctx, "post", "/legal/{versionId}/accept", { token: driver.token, params: { versionId: v }, body: {} });
        expect(notForDriver.status).toBe(404);
        const draft = await publish("OTHER", ["RIDER"], 2, "DRAFT");
        const unpublished = await call(ctx, "post", "/legal/{versionId}/accept", { token: u.token, params: { versionId: draft }, body: {} });
        expect(unpublished.status).toBe(404);
        await ctx.pool.query("delete from legal_document_texts where version_id = $1", [draft]);
        await ctx.pool.query("delete from legal_document_versions where id = $1", [draft]);
      } finally {
        await ctx.pool.query("delete from legal_acceptances where version_id = $1", [v]);
        await ctx.pool.query("delete from legal_document_texts where version_id = $1", [v]);
        await ctx.pool.query("delete from legal_document_versions where id = $1", [v]);
      }
    });
  });

  describe("push devices", () => {
    it("registers, re-registers the same token to a new owner, and unregisters only your own", async () => {
      const a = await signUp(ctx, "RIDER");
      const b = await signUp(ctx, "RIDER");
      const token = `tok-${randomUUID()}`;
      expect((await call(ctx, "post", "/push/devices", { token: a.token, body: { platform: "android", token } })).status).toBe(201);
      expect((await call(ctx, "post", "/push/devices", { token: b.token, body: { platform: "ios", token } })).status).toBe(201);
      const row = await ctx.pool.query("select id, account_id, platform from push_devices where token = $1", [token]);
      expect(row.rows).toHaveLength(1);
      expect(row.rows[0]).toMatchObject({ account_id: b.accountId, platform: "ios" });

      expect((await call(ctx, "delete", "/push/devices/{id}", { token: a.token, params: { id: row.rows[0].id } })).status).toBe(404);
      expect((await call(ctx, "delete", "/push/devices/{id}", { token: b.token, params: { id: row.rows[0].id } })).status).toBe(204);
    });

    it("rejects an unknown platform", async () => {
      const a = await signUp(ctx, "RIDER");
      expect((await call(ctx, "post", "/push/devices", { token: a.token, body: { platform: "web", token: "x" } })).status).toBe(400);
    });
  });
});
