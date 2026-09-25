import { TestContext, call, createTestContext, randomPhone, requestCode } from "./support/test-app";

const expectRetryAfter = (res: { headers: Record<string, unknown> }, max: number) => {
  const v = Number(res.headers["retry-after"]);
  expect(Number.isInteger(v)).toBe(true);
  expect(v).toBeGreaterThan(0);
  expect(v).toBeLessThanOrEqual(max);
};

describe("per-IP and per-phone abuse controls (contract 429 shape)", () => {
  describe("OTP request limits", () => {
    let ctx: TestContext;
    beforeAll(async () => {
      ctx = await createTestContext({
        OTP_RESEND_INTERVAL_S: "0",
        OTP_REQUEST_LIMIT_PER_IP_PER_HOUR: "3",
        OTP_REQUEST_LIMIT_PER_PHONE_PER_HOUR: "2",
      });
    });
    afterAll(() => ctx.close());

    it("blocks the 4th request from one IP (any phone) with OTP_RATE_LIMITED + Retry-After, other IPs unaffected", async () => {
      const ip = "203.0.113.7";
      for (let i = 0; i < 3; i++) {
        const r = await call(ctx, "post", "/auth/otp/request", { ip, body: { phone_e164: randomPhone(), app: "RIDER" } });
        expect(r.status).toBe(200);
      }
      const blocked = await call(ctx, "post", "/auth/otp/request", { ip, body: { phone_e164: randomPhone(), app: "RIDER" } });
      expect(blocked.status).toBe(429);
      expect(blocked.body.code).toBe("OTP_RATE_LIMITED");
      expectRetryAfter(blocked, 3600);

      const other = await call(ctx, "post", "/auth/otp/request", { body: { phone_e164: randomPhone(), app: "RIDER" } });
      expect(other.status).toBe(200);
    });

    it("blocks the 3rd request for one phone across different IPs", async () => {
      const phone = randomPhone();
      expect((await call(ctx, "post", "/auth/otp/request", { body: { phone_e164: phone, app: "RIDER" } })).status).toBe(200);
      expect((await call(ctx, "post", "/auth/otp/request", { body: { phone_e164: phone, app: "RIDER" } })).status).toBe(200);
      const blocked = await call(ctx, "post", "/auth/otp/request", { body: { phone_e164: phone, app: "RIDER" } });
      expect(blocked.status).toBe(429);
      expect(blocked.body.code).toBe("OTP_RATE_LIMITED");
      expectRetryAfter(blocked, 3600);
    });
  });

  describe("resend cooldown", () => {
    let ctx: TestContext;
    beforeAll(async () => {
      ctx = await createTestContext({ OTP_RESEND_INTERVAL_S: "30" });
    });
    afterAll(() => ctx.close());

    it("a second code within the interval is 429 with Retry-After <= interval", async () => {
      const phone = randomPhone();
      expect((await call(ctx, "post", "/auth/otp/request", { body: { phone_e164: phone, app: "RIDER" } })).status).toBe(200);
      const again = await call(ctx, "post", "/auth/otp/request", { body: { phone_e164: phone, app: "RIDER" } });
      expect(again.status).toBe(429);
      expect(again.body.code).toBe("OTP_RATE_LIMITED");
      expectRetryAfter(again, 30);
    });
  });

  describe("OTP verify limit per IP", () => {
    let ctx: TestContext;
    beforeAll(async () => {
      ctx = await createTestContext({ OTP_RESEND_INTERVAL_S: "0", OTP_VERIFY_LIMIT_PER_IP_PER_HOUR: "3" });
    });
    afterAll(() => ctx.close());

    it("stops guessing across many challenges from one IP even though each challenge has attempts left", async () => {
      const ip = "198.51.100.9";
      for (let i = 0; i < 3; i++) {
        const { challengeId, code } = await requestCode(ctx, randomPhone());
        const r = await call(ctx, "post", "/auth/otp/verify", {
          ip,
          body: { challenge_id: challengeId, code: code === "000000" ? "111111" : "000000" },
        });
        expect(r.status).toBe(400);
      }
      const { challengeId, code } = await requestCode(ctx, randomPhone());
      const blocked = await call(ctx, "post", "/auth/otp/verify", { ip, body: { challenge_id: challengeId, code } });
      expect(blocked.status).toBe(429);
      expect(blocked.body.code).toBe("OTP_RATE_LIMITED");
      expectRetryAfter(blocked, 3600);
    });
  });

  describe("global per-IP ceiling", () => {
    let ctx: TestContext;
    beforeAll(async () => {
      ctx = await createTestContext({ GLOBAL_LIMIT_PER_IP_PER_MINUTE: "3" });
    });
    afterAll(() => ctx.close());

    it("returns RATE_LIMITED + Retry-After once an IP exceeds the per-minute ceiling", async () => {
      const ip = "192.0.2.44";
      for (let i = 0; i < 3; i++) expect((await call(ctx, "get", "/me", { ip })).status).toBe(401);
      const blocked = await call(ctx, "get", "/me", { ip });
      expect(blocked.status).toBe(429);
      expect(blocked.body.code).toBe("RATE_LIMITED");
      expectRetryAfter(blocked, 60);
    });
  });

  describe("no SMS provider configured", () => {
    let ctx: TestContext;
    beforeAll(async () => {
      ctx = await createTestContext({ SMS_ADAPTER: "disabled", OTP_RESEND_INTERVAL_S: "0" });
    });
    afterAll(() => ctx.close());

    it("answers 503 PROVIDER_TEMPORARY_FAILURE and leaves no redeemable challenge", async () => {
      const phone = randomPhone();
      const res = await call(ctx, "post", "/auth/otp/request", { body: { phone_e164: phone, app: "RIDER" } });
      expect(res.status).toBe(503);
      expect(res.body.code).toBe("PROVIDER_TEMPORARY_FAILURE");
      const rows = await ctx.pool.query("SELECT consumed_at FROM otp_challenges WHERE phone_e164 = $1", [phone]);
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0].consumed_at).not.toBeNull();
    });
  });
});
