import "reflect-metadata";
import { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import Redis from "ioredis";
import { Pool } from "pg";
import request from "supertest";
import { AppModule } from "../../src/app.module";
import { configureApp } from "../../src/app.setup";
import { loadEnv } from "../../src/config/env";
import { assertMatchesContract } from "./openapi-contract";

export interface TestContext {
  app: INestApplication;
  pool: Pool;
  redis: Redis;
  prefix: string;
  close(): Promise<void>;
}

/** Boots the real AppModule against the isolated database/prefix set by global-setup. */
export async function createTestContext(envOverrides: Record<string, string> = {}): Promise<TestContext> {
  const dbUrl = process.env.DATABASE_URL ?? "";
  if (!/\/wasselne_test_[0-9a-f]+/.test(dbUrl)) {
    throw new Error(`Refusing to run e2e tests against a non-isolated database: ${dbUrl}`);
  }
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(envOverrides)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  // Tests need the process env to say TRUST_PROXY_HOPS=1 so X-Forwarded-For selects the client IP.
  process.env.TRUST_PROXY_HOPS ??= "1";
  const app = await NestFactory.create(AppModule, { logger: false });
  configureApp(app, loadEnv(process.env));
  await app.init();
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const pool = new Pool({ connectionString: dbUrl, max: 4 });
  const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
  const prefix = process.env.REDIS_KEY_PREFIX ?? "wsl:";
  return {
    app,
    pool,
    redis,
    prefix,
    async close() {
      await app.close();
      await pool.end();
      redis.disconnect();
    },
  };
}

let ipCounter = 0;
/** A fresh fake client IP per call, so per-IP limits never leak between tests. */
export function freshIp(): string {
  ipCounter += 1;
  return `10.${Math.floor(Math.random() * 200)}.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`;
}

export function randomPhone(): string {
  return `+9613${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;
}

/** Sends a request and asserts the response matches docs/phase-2/openapi.yaml. */
export async function call(
  ctx: TestContext,
  method: "get" | "post",
  path: string, // path as written in the contract, e.g. "/auth/otp/request"
  opts: { body?: unknown; token?: string; ip?: string } = {},
) {
  let req = request(ctx.app.getHttpServer())[method](`/v1${path}`).set("X-Forwarded-For", opts.ip ?? freshIp());
  if (opts.token) req = req.set("Authorization", `Bearer ${opts.token}`);
  const res = await (opts.body !== undefined ? req.send(opts.body as object) : req);
  assertMatchesContract(method, path, { status: res.status, headers: res.headers, body: res.body });
  return res;
}

export async function readDevCode(ctx: TestContext, challengeId: string): Promise<string> {
  const code = await ctx.redis.get(`${ctx.prefix}dev:sms:${challengeId}`);
  if (!code) throw new Error("dev SMS code not found in Redis");
  return code;
}

export async function requestCode(ctx: TestContext, phone: string, app: "RIDER" | "DRIVER" = "RIDER") {
  const res = await call(ctx, "post", "/auth/otp/request", { body: { phone_e164: phone, app } });
  if (res.status !== 200) throw new Error(`otp request failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { challengeId: res.body.challenge_id as string, code: await readDevCode(ctx, res.body.challenge_id) };
}
