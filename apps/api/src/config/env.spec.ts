import { loadEnv } from "./env";

const validBase = {
  DATABASE_URL: "postgres://user:pass@localhost:5432/db",
  REDIS_URL: "redis://localhost:6379",
  JWT_ACCESS_SECRET: "a".repeat(32),
  ADMIN_TOTP_ENC_KEY: "ab".repeat(32),
};

describe("loadEnv", () => {
  it("accepts a minimal valid environment and applies defaults", () => {
    const env = loadEnv(validBase);
    expect(env.NODE_ENV).toBe("development");
    expect(env.API_PORT).toBe(3000);
    expect(env.SMS_ADAPTER).toBe("dev");
  });

  it("rejects a missing DATABASE_URL", () => {
    const { DATABASE_URL: _drop, ...rest } = validBase;
    expect(() => loadEnv(rest)).toThrow(/DATABASE_URL/);
  });

  it("rejects a malformed ADMIN_TOTP_ENC_KEY", () => {
    expect(() => loadEnv({ ...validBase, ADMIN_TOTP_ENC_KEY: "short" })).toThrow(/ADMIN_TOTP_ENC_KEY/);
  });

  it("rejects a JWT secret shorter than 32 characters", () => {
    expect(() => loadEnv({ ...validBase, JWT_ACCESS_SECRET: "short" })).toThrow();
  });

  it("refuses the dev SMS adapter in production", () => {
    expect(() => loadEnv({ ...validBase, NODE_ENV: "production", SMS_ADAPTER: "dev" })).toThrow(
      /refused in production/,
    );
  });

  it("allows the disabled SMS adapter in production", () => {
    expect(() => loadEnv({ ...validBase, NODE_ENV: "production", SMS_ADAPTER: "disabled" })).not.toThrow();
  });
});
