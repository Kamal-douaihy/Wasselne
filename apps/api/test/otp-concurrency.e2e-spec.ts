// Concurrency and atomicity of OTP consumption + account/session creation, against a real
// PostgreSQL in an isolated database. Parallel requests use distinct fake client IPs so the
// per-IP limiter does not interfere; only the database transaction logic is under test.
import { JwtService } from "../src/modules/identity/jwt.service";
import { TestContext, call, createTestContext, randomPhone, requestCode } from "./support/test-app";

const N = 20;
const count = async (ctx: TestContext, sql: string, params: unknown[] = []) =>
  Number((await ctx.pool.query(sql, params)).rows[0].n);
const statuses = (rs: { status: number }[]) => rs.map((r) => r.status).sort();

describe("OTP consumption is atomic and race-safe", () => {
  let ctx: TestContext;
  const profile = { first_name: "A", last_name: "B", gender: "MALE", accepted_legal_version_ids: [] };

  beforeAll(async () => {
    ctx = await createTestContext({ OTP_RESEND_INTERVAL_S: "0", OTP_VERIFY_LIMIT_PER_IP_PER_HOUR: "1000" });
  });
  afterAll(() => ctx.close());

  async function makeAccount(phone: string) {
    const { challengeId, code } = await requestCode(ctx, phone);
    const v = await call(ctx, "post", "/auth/otp/verify", { body: { challenge_id: challengeId, code } });
    const created = await call(ctx, "post", "/me/complete-profile", { token: v.body.needs_profile_token, body: profile });
    return (await call(ctx, "get", "/me", { token: created.body.access_token })).body.id as string;
  }

  it(`${N} parallel verifies of one challenge (existing account): exactly one session, the rest 410`, async () => {
    const phone = randomPhone();
    const accountId = await makeAccount(phone);
    const before = await count(ctx, "SELECT count(*) n FROM sessions WHERE account_id = $1", [accountId]);
    const { challengeId, code } = await requestCode(ctx, phone);

    const results = await Promise.all(
      Array.from({ length: N }, () => call(ctx, "post", "/auth/otp/verify", { body: { challenge_id: challengeId, code } })),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 410)).toHaveLength(N - 1);
    expect(results.find((r) => r.status === 200)!.body.status).toBe("SESSION");
    expect(await count(ctx, "SELECT count(*) n FROM sessions WHERE account_id = $1", [accountId])).toBe(before + 1);
    expect(await count(ctx, "SELECT count(*) n FROM otp_challenges WHERE id = $1 AND consumed_at IS NOT NULL", [challengeId])).toBe(1);
  });

  it(`${N} parallel verifies of one challenge (new number): exactly one NEEDS_PROFILE token, no account created`, async () => {
    const phone = randomPhone();
    const { challengeId, code } = await requestCode(ctx, phone);
    const results = await Promise.all(
      Array.from({ length: N }, () => call(ctx, "post", "/auth/otp/verify", { body: { challenge_id: challengeId, code } })),
    );
    expect(statuses(results)).toEqual([200, ...Array(N - 1).fill(410)]);
    expect(await count(ctx, "SELECT count(*) n FROM accounts WHERE phone_e164 = $1", [phone])).toBe(0);
  });

  it("parallel wrong guesses never exceed the attempt limit, and a correct code after lock-out is refused", async () => {
    const { challengeId, code } = await requestCode(ctx, randomPhone());
    const wrong = code === "000000" ? "111111" : "000000";
    const results = await Promise.all(
      Array.from({ length: 12 }, () => call(ctx, "post", "/auth/otp/verify", { body: { challenge_id: challengeId, code: wrong } })),
    );
    expect(statuses(results)).toEqual([400, 400, 400, 400, 400, 429, 429, 429, 429, 429, 429, 429]);
    expect(await count(ctx, "SELECT attempts n FROM otp_challenges WHERE id = $1", [challengeId])).toBe(5);
    const late = await call(ctx, "post", "/auth/otp/verify", { body: { challenge_id: challengeId, code } });
    expect(late.status).toBe(429);
    expect(await count(ctx, "SELECT count(*) n FROM otp_challenges WHERE id = $1 AND consumed_at IS NOT NULL", [challengeId])).toBe(0);
  });

  it("correct code racing wrong guesses: at most one success, attempts stay within the limit", async () => {
    const { challengeId, code } = await requestCode(ctx, randomPhone());
    const wrong = code === "000000" ? "111111" : "000000";
    const results = await Promise.all([
      ...Array.from({ length: 6 }, () => call(ctx, "post", "/auth/otp/verify", { body: { challenge_id: challengeId, code: wrong } })),
      ...Array.from({ length: 6 }, () => call(ctx, "post", "/auth/otp/verify", { body: { challenge_id: challengeId, code } })),
    ]);
    expect(results.filter((r) => r.status === 200).length).toBeLessThanOrEqual(1);
    expect(await count(ctx, "SELECT attempts n FROM otp_challenges WHERE id = $1", [challengeId])).toBeLessThanOrEqual(5);
  });

  it("parallel complete-profile with one token: exactly one account, one session, one 201", async () => {
    const phone = randomPhone();
    const { challengeId, code } = await requestCode(ctx, phone);
    const v = await call(ctx, "post", "/auth/otp/verify", { body: { challenge_id: challengeId, code } });
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        call(ctx, "post", "/me/complete-profile", { token: v.body.needs_profile_token, body: profile }),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 401)).toHaveLength(9);
    expect(await count(ctx, "SELECT count(*) n FROM accounts WHERE phone_e164 = $1", [phone])).toBe(1);
    expect(
      await count(ctx, "SELECT count(*) n FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE a.phone_e164 = $1", [phone]),
    ).toBe(1);
  });

  it("a failure after consumption rolls the whole verify back (challenge stays redeemable, no session)", async () => {
    const phone = randomPhone();
    const accountId = await makeAccount(phone);
    const before = await count(ctx, "SELECT count(*) n FROM sessions WHERE account_id = $1", [accountId]);
    const { challengeId, code } = await requestCode(ctx, phone);

    const jwt = ctx.app.get(JwtService);
    const spy = jest.spyOn(jwt, "signAccessToken").mockImplementationOnce(() => {
      throw new Error("injected failure after the challenge was consumed");
    });
    const failed = await call(ctx, "post", "/auth/otp/verify", { body: { challenge_id: challengeId, code } }).catch((e) => e);
    // Not a contract-declared status: assert the raw response instead of the contract helper.
    expect(String(failed)).toContain("returned 500");
    spy.mockRestore();

    expect(await count(ctx, "SELECT count(*) n FROM otp_challenges WHERE id = $1 AND consumed_at IS NULL", [challengeId])).toBe(1);
    expect(await count(ctx, "SELECT count(*) n FROM sessions WHERE account_id = $1", [accountId])).toBe(before);

    const retry = await call(ctx, "post", "/auth/otp/verify", { body: { challenge_id: challengeId, code } });
    expect(retry.status).toBe(200);
    expect(retry.body.status).toBe("SESSION");
  });

  it("a failure inside complete-profile leaves no account behind", async () => {
    const phone = randomPhone();
    const { challengeId, code } = await requestCode(ctx, phone);
    const v = await call(ctx, "post", "/auth/otp/verify", { body: { challenge_id: challengeId, code } });

    const jwt = ctx.app.get(JwtService);
    const spy = jest.spyOn(jwt, "signAccessToken").mockImplementationOnce(() => {
      throw new Error("injected failure after the account row was inserted");
    });
    await call(ctx, "post", "/me/complete-profile", { token: v.body.needs_profile_token, body: profile }).catch(() => undefined);
    spy.mockRestore();

    expect(await count(ctx, "SELECT count(*) n FROM accounts WHERE phone_e164 = $1", [phone])).toBe(0);
    const ok = await call(ctx, "post", "/me/complete-profile", { token: v.body.needs_profile_token, body: profile });
    expect(ok.status).toBe(201);
  });
});
