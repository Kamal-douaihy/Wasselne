// Runs packages/flutter_core/test/live_api_test.dart: the real Dart ApiClient against the real API,
// PostgreSQL, Redis and MinIO, all in throwaway resources. Needs the docker infra up (redis-cli is
// reached through `docker exec` to read the dev OTP code, which the API never returns).
// Run: pnpm --filter @wasselne/api run e2e:dart-client
import { ChildProcess, spawn, spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { join } from "node:path";
import { config as loadDotenv } from "dotenv";
import Redis from "ioredis";
import { Pool } from "pg";
import { runMigrations } from "../src/db/migrations-runner";
import { createTempDatabase } from "../src/db/temp-database";

const API_DIR = join(__dirname, "..");
const CORE_DIR = join(API_DIR, "..", "..", "packages", "flutter_core");
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

async function waitFor(url: string): Promise<void> {
  for (let i = 0; i < 150; i++) {
    try {
      if ((await fetch(url)).status < 500) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`timed out waiting for ${url}`);
}

async function main(): Promise<void> {
  const db = await createTempDatabase(process.env.DATABASE_URL!, "wasselne_e2e_dart");
  const redisPrefix = `e2edart:${randomBytes(4).toString("hex")}:`;
  const s3Prefix = `e2edart/${randomBytes(4).toString("hex")}/`;
  const port = await freePort();
  let api: ChildProcess | undefined;
  let code = 1;
  try {
    await runMigrations(db.url);
    const pool = new Pool({ connectionString: db.url });
    const cat = randomUUID(), idDoc = randomUUID(), regDoc = randomUUID();
    await pool.query("insert into vehicle_categories (id, code, names, base_type, seats, icon, active) values ($1,'live-car','{\"en\":\"Car\"}','CAR',4,'car',true)", [cat]);
    await pool.query("insert into document_types (id, code, names, subject, has_expiry) values ($1,'live-id','{\"en\":\"ID\"}','DRIVER',false), ($2,'live-reg','{\"en\":\"Registration\"}','VEHICLE',true)", [idDoc, regDoc]);
    await pool.query("insert into category_document_requirements values ($1,$2), ($1,$3)", [cat, idDoc, regDoc]);
    await pool.end();

    api = spawn(join(API_DIR, "node_modules/.bin/tsx"), ["src/main.api.ts"], {
      cwd: API_DIR,
      env: { ...process.env, DATABASE_URL: db.url, REDIS_KEY_PREFIX: redisPrefix, S3_KEY_PREFIX: s3Prefix, API_PORT: String(port), NODE_ENV: "test", SMS_ADAPTER: "dev", GLOBAL_LIMIT_PER_IP_PER_MINUTE: "5000", OTP_RESEND_INTERVAL_S: "0" },
      stdio: "ignore",
    });
    await waitFor(`http://127.0.0.1:${port}/health`);

    // E2E_REDIS_CLI (e.g. "redis-cli") wins; locally the redis container from infra/local is used.
    let redisCli = process.env.E2E_REDIS_CLI;
    if (!redisCli) {
      const redisContainer = spawnSync("docker", ["ps", "--filter", "name=wasselne-local-redis", "--format", "{{.Names}}"]).stdout.toString().trim().split("\n")[0];
      if (!redisContainer) throw new Error("wasselne-local-redis container not running (pnpm infra:up)");
      redisCli = `docker exec ${redisContainer} redis-cli`;
    }
    const flutter = spawn(
      "flutter",
      ["test", "test/live_api_test.dart", `--dart-define=WASSELNE_LIVE_API=http://127.0.0.1:${port}`, `--dart-define=WASSELNE_REDIS_CLI=${redisCli}`, `--dart-define=WASSELNE_REDIS_PREFIX=${redisPrefix}`],
      { cwd: CORE_DIR, stdio: "inherit" },
    );
    code = await new Promise<number>((resolve) => flutter.on("exit", (c) => resolve(c ?? 1)));
  } finally {
    api?.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 600));
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
  process.exit(code);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
