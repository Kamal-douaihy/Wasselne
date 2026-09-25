// OTP sign-in, checked response-by-response against docs/phase-2/openapi.yaml (status codes,
// bodies, X-Correlation-Id, Retry-After) on an isolated database.
import request from "supertest";
import { TestContext, call, createTestContext, freshIp, randomPhone, requestCode } from "./support/test-app";

const profile = (extra: Record<string, unknown> = {}) => ({
  first_name: "Test",
  last_name: "Rider",
  gender: "FEMALE",
  accepted_legal_version_ids: [],
  ...extra,
});

describe("OTP sign-in matches the OpenAPI contract", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext({ OTP_RESEND_INTERVAL_S: "0" });
  });
  afterAll(() => ctx.close());

  it("request: 200 with exactly challenge_id, expires_at, resend_after (no code in the body)", async () => {
    const res = await call(ctx, "post", "/auth/otp/request", { body: { phone_e164: randomPhone(), app: "RIDER" } });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(["challenge_id", "expires_at", "resend_after"]);
    expect(new Date(res.body.resend_after).getTime()).toBeLessThanOrEqual(new Date(res.body.expires_at).getTime());
  });

  it("request: validation failure is a flat Error body with correlation_id", async () => {
    const res = await call(ctx, "post", "/auth/otp/request", { body: { phone_e164: "123", app: "RIDER" } });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_FAILED");
    expect(res.body.correlation_id).toBe(res.headers["x-correlation-id"]);
    expect(res.body.error).toBeUndefined();
  });

  it("new number: verify -> NEEDS_PROFILE, complete-profile -> 201, /me -> 200, next sign-in -> SESSION", async () => {
    const phone = randomPhone();
    const first = await requestCode(ctx, phone);
    const v1 = await call(ctx, "post", "/auth/otp/verify", { body: { challenge_id: first.challengeId, code: first.code } });
    expect(v1.status).toBe(200);
    expect(v1.body.status).toBe("NEEDS_PROFILE");
    expect(v1.body.needs_profile_token).toBeDefined();
    expect(v1.body.session).toBeUndefined();

    const created = await call(ctx, "post", "/me/complete-profile", { token: v1.body.needs_profile_token, body: profile() });
    expect(created.status).toBe(201);

    const me = await call(ctx, "get", "/me", { token: created.body.access_token });
    expect(me.status).toBe(200);
    expect(me.body.phone_e164).toBe(phone);
    expect(me.body.gender).toBe("FEMALE");
    expect(me.body.gender_confirmed).toBe(false);

    const second = await requestCode(ctx, phone);
    const v2 = await call(ctx, "post", "/auth/otp/verify", { body: { challenge_id: second.challengeId, code: second.code } });
    expect(v2.body.status).toBe("SESSION");
    expect(v2.body.account_id).toBe(me.body.id);
    const me2 = await call(ctx, "get", "/me", { token: v2.body.session.access_token });
    expect(me2.body.id).toBe(me.body.id);
  });

  it("wrong code: 400 OTP_INVALID; locked after the attempt limit: 429 OTP_RATE_LIMITED + Retry-After", async () => {
    const { challengeId, code } = await requestCode(ctx, randomPhone());
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) {
      const r = await call(ctx, "post", "/auth/otp/verify", { body: { challenge_id: challengeId, code: wrong } });
      expect(r.status).toBe(400);
      expect(r.body.code).toBe("OTP_INVALID");
    }
    const locked = await call(ctx, "post", "/auth/otp/verify", { body: { challenge_id: challengeId, code } });
    expect(locked.status).toBe(429);
    expect(locked.body.code).toBe("OTP_RATE_LIMITED");
    expect(Number(locked.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("used, expired and unknown challenges", async () => {
    const { challengeId, code } = await requestCode(ctx, randomPhone());
    await call(ctx, "post", "/auth/otp/verify", { body: { challenge_id: challengeId, code } });
    const reused = await call(ctx, "post", "/auth/otp/verify", { body: { challenge_id: challengeId, code } });
    expect(reused.status).toBe(410);
    expect(reused.body.code).toBe("OTP_EXPIRED");

    const other = await requestCode(ctx, randomPhone());
    await ctx.pool.query("UPDATE otp_challenges SET expires_at = now() - interval '1 second' WHERE id = $1", [other.challengeId]);
    const expired = await call(ctx, "post", "/auth/otp/verify", { body: { challenge_id: other.challengeId, code: other.code } });
    expect(expired.status).toBe(410);
    expect(expired.body.code).toBe("OTP_EXPIRED");

    const unknown = await call(ctx, "post", "/auth/otp/verify", {
      body: { challenge_id: "00000000-0000-4000-8000-000000000000", code: "123456" },
    });
    expect(unknown.status).toBe(400);
    expect(unknown.body.code).toBe("OTP_INVALID");
  });

  it("bearer handling: missing/garbage/wrong-kind tokens are 401 NOT_AUTHENTICATED", async () => {
    const none = await call(ctx, "get", "/me");
    expect(none.status).toBe(401);
    expect(none.body.code).toBe("NOT_AUTHENTICATED");
    expect((await call(ctx, "get", "/me", { token: "garbage" })).status).toBe(401);

    const { challengeId, code } = await requestCode(ctx, randomPhone());
    const v = await call(ctx, "post", "/auth/otp/verify", { body: { challenge_id: challengeId, code } });
    // A needs-profile token must not work as an access token...
    expect((await call(ctx, "get", "/me", { token: v.body.needs_profile_token })).status).toBe(401);
    // ...and an access token must not work as a needs-profile token.
    const created = await call(ctx, "post", "/me/complete-profile", { token: v.body.needs_profile_token, body: profile() });
    expect((await call(ctx, "post", "/me/complete-profile", { token: created.body.access_token, body: profile() })).status).toBe(401);
  });

  it("complete-profile rejects an unknown legal version (400) and a reused token (401)", async () => {
    const { challengeId, code } = await requestCode(ctx, randomPhone());
    const v = await call(ctx, "post", "/auth/otp/verify", { body: { challenge_id: challengeId, code } });
    const bad = await call(ctx, "post", "/me/complete-profile", {
      token: v.body.needs_profile_token,
      body: profile({ accepted_legal_version_ids: ["00000000-0000-4000-8000-000000000001"] }),
    });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe("VALIDATION_FAILED");
    expect((await call(ctx, "post", "/me/complete-profile", { token: v.body.needs_profile_token, body: profile() })).status).toBe(201);
    const again = await call(ctx, "post", "/me/complete-profile", { token: v.body.needs_profile_token, body: profile() });
    expect(again.status).toBe(401);
  });

  it("blocked and deleted accounts get 403", async () => {
    const phone = randomPhone();
    const a = await requestCode(ctx, phone);
    const v = await call(ctx, "post", "/auth/otp/verify", { body: { challenge_id: a.challengeId, code: a.code } });
    const created = await call(ctx, "post", "/me/complete-profile", { token: v.body.needs_profile_token, body: profile() });
    const me = await call(ctx, "get", "/me", { token: created.body.access_token });

    await ctx.pool.query(
      "INSERT INTO account_blocks(account_id, applies_to, reason, created_by, effective_at) VALUES ($1, '{RIDER}', 'test', $1, now())",
      [me.body.id],
    );
    const b = await requestCode(ctx, phone);
    const blocked = await call(ctx, "post", "/auth/otp/verify", { body: { challenge_id: b.challengeId, code: b.code } });
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe("ACCOUNT_BLOCKED");
    const stillValid = await ctx.pool.query("SELECT consumed_at FROM otp_challenges WHERE id = $1", [b.challengeId]);
    expect(stillValid.rows[0].consumed_at).toBeNull();

    await ctx.pool.query("UPDATE account_blocks SET lifted_at = now() WHERE account_id = $1", [me.body.id]);
    await ctx.pool.query("UPDATE accounts SET status = 'DELETED' WHERE id = $1", [me.body.id]);
    const c = await requestCode(ctx, phone);
    const deleted = await call(ctx, "post", "/auth/otp/verify", { body: { challenge_id: c.challengeId, code: c.code } });
    expect(deleted.status).toBe(403);
    expect(deleted.body.code).toBe("NOT_AUTHORIZED");
  });

  it("unknown routes and malformed JSON use the same Error shape", async () => {
    const nf = await request(ctx.app.getHttpServer()).get("/v1/nope").set("X-Forwarded-For", freshIp());
    expect(nf.status).toBe(404);
    expect(nf.body.code).toBe("NOT_FOUND");
    expect(nf.body.correlation_id).toBe(nf.headers["x-correlation-id"]);

    const bad = await request(ctx.app.getHttpServer())
      .post("/v1/auth/otp/request")
      .set("X-Forwarded-For", freshIp())
      .set("Content-Type", "application/json")
      .send("{not json");
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe("VALIDATION_FAILED");
    expect(bad.body.correlation_id).toBeDefined();
  });

  it("health is reachable without /v1 and reports both dependencies", async () => {
    const res = await request(ctx.app.getHttpServer()).get("/health");
    expect(res.body).toEqual({ status: "ok", checks: { database: "ok", redis: "ok" } });
  });
});
