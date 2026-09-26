// Browser end-to-end run of the admin console against the REAL API, database, Redis and MinIO:
//  1. throwaway database + Redis prefix + S3 prefix (nothing of the developer's data is touched)
//  2. API on a free port, console (next start, must be built) on another
//  3. seeds admins (one not yet enrolled for MFA), a submitted driver application, a rider
//  4. runs Playwright (Chromium) and cleans everything up
// Run: pnpm --filter @wasselne/api run e2e:admin-console   (needs docker infra up and `pnpm --filter @wasselne/admin build`)
import { ChildProcess, spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { join } from "node:path";
import { config as loadDotenv } from "dotenv";
import Redis from "ioredis";
import { authenticator } from "otplib";
import { Pool } from "pg";
import { encryptSecret, hashPassword } from "../src/modules/admin/admin-crypto";
import { runMigrations } from "../src/db/migrations-runner";
import { createTempDatabase } from "../src/db/temp-database";

const API_DIR = join(__dirname, "..");
const ADMIN_DIR = join(API_DIR, "..", "admin");
loadDotenv({ path: join(API_DIR, ".env") });

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
    s.on("error", reject);
  });

async function waitFor(url: string, ms = 60_000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`timed out waiting for ${url}`);
}

const children: ChildProcess[] = [];
function start(cmd: string, args: string[], cwd: string, env: Record<string, string>): ChildProcess {
  const c = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  c.stdout?.on("data", (d) => process.env.E2E_VERBOSE && process.stdout.write(d));
  c.stderr?.on("data", (d) => process.env.E2E_VERBOSE && process.stderr.write(d));
  children.push(c);
  return c;
}

async function main(): Promise<void> {
  const serverUrl = process.env.DATABASE_URL!;
  const db = await createTempDatabase(serverUrl, "wasselne_e2e_admin");
  const redisPrefix = `e2eadmin:${randomBytes(4).toString("hex")}:`;
  const s3Prefix = `e2eadmin/${randomBytes(4).toString("hex")}/`;
  const apiPort = await freePort();
  const consolePort = await freePort();
  const apiUrl = `http://127.0.0.1:${apiPort}`;
  const consoleUrl = `http://127.0.0.1:${consolePort}`;
  let exitCode = 1;
  try {
    await runMigrations(db.url);
    const pool = new Pool({ connectionString: db.url });

    // ---- seed: admins
    const key = process.env.ADMIN_TOTP_ENC_KEY!;
    const mkAdmin = async (roles: string[], enrolled: boolean) => {
      const email = `${roles[0]!.toLowerCase()}-${randomBytes(3).toString("hex")}@example.test`;
      const password = `pw-${randomBytes(9).toString("hex")}`;
      const secret = authenticator.generateSecret();
      const r = await pool.query(
        "insert into admin_users (email, full_name, password_hash, totp_secret_enc, mfa_enrolled_at) values ($1,$2,$3,$4,$5) returning id",
        [email, `${roles[0]} Tester`, await hashPassword(password), enrolled ? encryptSecret(secret, key) : null, enrolled ? new Date() : null],
      );
      for (const role of roles) await pool.query("insert into admin_user_roles (admin_id, role_code) values ($1,$2)", [r.rows[0].id, role]);
      return { email, password, secret };
    };
    const reviewer = await mkAdmin(["DRIVER_REVIEWER"], false); // exercises first-time MFA enrolment in the browser
    const auditor = await mkAdmin(["AUDITOR"], true);

    // ---- start the API
    const apiEnv = {
      DATABASE_URL: db.url, REDIS_KEY_PREFIX: redisPrefix, S3_KEY_PREFIX: s3Prefix, API_PORT: String(apiPort),
      NODE_ENV: "test", SMS_ADAPTER: "dev", TRUST_PROXY_HOPS: "0", GLOBAL_LIMIT_PER_IP_PER_MINUTE: "5000",
    };
    start(join(API_DIR, "node_modules/.bin/tsx"), ["src/main.api.ts"], API_DIR, apiEnv);
    await waitFor(`${apiUrl}/health`);

    // ---- seed: catalog + a submitted driver application through the real endpoints
    const catId = randomUUID(), idDoc = randomUUID(), regDoc = randomUUID();
    await pool.query("insert into vehicle_categories (id, code, names, base_type, seats, icon, active) values ($1,'e2e-car','{\"en\":\"Car\"}','CAR',4,'car',true)", [catId]);
    await pool.query("insert into document_types (id, code, names, subject, has_expiry) values ($1,'e2e-id','{\"en\":\"National ID\"}','DRIVER',false), ($2,'e2e-reg','{\"en\":\"Vehicle registration\"}','VEHICLE',true)", [idDoc, regDoc]);
    await pool.query("insert into category_document_requirements values ($1,$2), ($1,$3)", [catId, idDoc, regDoc]);

    const api = async (method: string, path: string, body?: unknown, token?: string) => {
      const res = await fetch(`${apiUrl}/v1${path}`, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
      const text = await res.text();
      return { status: res.status, body: text ? JSON.parse(text) : null };
    };
    const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
    const signUp = async (app: "RIDER" | "DRIVER", first: string) => {
      const phone = `+9613${Math.floor(1_000_000 + Math.random() * 8_999_999)}`;
      const req = await api("POST", "/auth/otp/request", { phone_e164: phone, app });
      const code = await redis.get(`${redisPrefix}dev:sms:${req.body.challenge_id}`);
      const ver = await api("POST", "/auth/otp/verify", { challenge_id: req.body.challenge_id, code });
      const done = await api("POST", "/me/complete-profile", { first_name: first, last_name: "Seeded", gender: "MALE", accepted_legal_version_ids: [] }, ver.body.needs_profile_token);
      const me = await api("GET", "/me", undefined, done.body.access_token);
      return { id: me.body.id as string, token: done.body.access_token as string, phone };
    };
    const driver = await signUp("DRIVER", "Dana");
    await signUp("RIDER", "Rami");
    const must = (r: { status: number; body: unknown }, s: number, what: string) => { if (r.status !== s) throw new Error(`${what}: ${r.status} ${JSON.stringify(r.body)}`); };
    must(await api("POST", "/driver/onboarding/profile", { first_name: "Dana", last_name: "Seeded", gender: "MALE", accepted_legal_version_ids: [] }, driver.token), 200, "profile");
    must(await api("POST", "/driver/onboarding/vehicle", { base_type: "CAR", make: "Kia", model: "Rio", year: 2020, color: "Grey", plate: "E2E 100", seats: 4 }, driver.token), 200, "vehicle");
    must(await api("POST", "/driver/onboarding/categories", { category_ids: [catId] }, driver.token), 200, "categories");
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(64)]);
    for (const [typeId, extra] of [[idDoc, {}], [regDoc, { expires_on: "2099-01-01" }]] as const) {
      const auth = await api("POST", "/uploads/authorize", { purpose: "DRIVER_DOCUMENT", content_type: "image/jpeg", max_bytes: 100000 }, driver.token);
      const put = await fetch(auth.body.put_url, { method: "PUT", headers: auth.body.required_headers, body: jpeg });
      if (!put.ok) throw new Error(`PUT failed ${put.status}`);
      must(await api("POST", `/uploads/${auth.body.upload_id}/complete`, undefined, driver.token), 200, "complete");
      must(await api("POST", "/driver/onboarding/documents", { document_type_id: typeId, upload_id: auth.body.upload_id, ...extra }, driver.token), 201, "attach");
    }
    must(await api("POST", "/driver/onboarding/submit", undefined, driver.token), 200, "submit");
    redis.disconnect();

    // ---- console
    start(join(ADMIN_DIR, "node_modules/.bin/next"), ["start", "-p", String(consolePort)], ADMIN_DIR, { API_BASE_URL: apiUrl, NODE_ENV: "production" });
    await waitFor(`${consoleUrl}/login`);

    // ---- Playwright
    const pw = spawn(join(ADMIN_DIR, "node_modules/.bin/playwright"), ["test"], {
      cwd: ADMIN_DIR,
      stdio: "inherit",
      env: {
        ...process.env,
        CONSOLE_URL: consoleUrl,
        E2E_REVIEWER: JSON.stringify(reviewer), E2E_AUDITOR: JSON.stringify(auditor),
        E2E_DRIVER_ID: driver.id, E2E_API_URL: apiUrl, E2E_DB_URL: db.url,
      },
    });
    exitCode = await new Promise<number>((resolve) => pw.on("exit", (c) => resolve(c ?? 1)));
    await pool.end();
  } finally {
    for (const c of children) c.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 800));
    await db.drop().catch(() => undefined);
    const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
    const keys = await redis.keys(`${redisPrefix}*`);
    if (keys.length) await redis.del(...keys);
    redis.disconnect();
    const { S3Client, ListObjectsV2Command, DeleteObjectsCommand } = await import("@aws-sdk/client-s3");
    const s3 = new S3Client({ region: "us-east-1", endpoint: process.env.S3_ENDPOINT, forcePathStyle: true, credentials: { accessKeyId: process.env.S3_ACCESS_KEY!, secretAccessKey: process.env.S3_SECRET_KEY! } });
    const listed = await s3.send(new ListObjectsV2Command({ Bucket: process.env.S3_BUCKET!, Prefix: s3Prefix })).catch(() => undefined);
    if (listed?.Contents?.length) await s3.send(new DeleteObjectsCommand({ Bucket: process.env.S3_BUCKET!, Delete: { Objects: listed.Contents.map((o) => ({ Key: o.Key! })) } }));
    s3.destroy();
  }
  process.exit(exitCode);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
