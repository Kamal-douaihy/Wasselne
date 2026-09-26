import { config as loadDotenv } from "dotenv";
import { runMigrations } from "../../src/db/migrations-runner";
import { createTempDatabase } from "../../src/db/temp-database";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

export const STATE_FILE = join(__dirname, ".isolated-db.json");

// Every e2e run gets its own PostgreSQL database (all migrations applied) and its own Redis key
// prefix. The developer database is never read or written.
export default async function globalSetup(): Promise<void> {
  loadDotenv();
  const serverUrl = process.env.DATABASE_URL;
  if (!serverUrl) throw new Error("DATABASE_URL must point at a PostgreSQL server for e2e tests.");

  const db = await createTempDatabase(serverUrl, "wasselne_test");
  await runMigrations(db.url);
  const redisPrefix = `test:${randomBytes(4).toString("hex")}:`;

  // Uploaded test objects live under a per-run prefix so teardown can delete exactly them.
  const s3Prefix = `test/${randomBytes(4).toString("hex")}/`;

  process.env.DATABASE_URL = db.url;
  process.env.S3_KEY_PREFIX = s3Prefix;
  process.env.REDIS_KEY_PREFIX = redisPrefix;
  process.env.NODE_ENV = "test";
  process.env.SMS_ADAPTER = "dev";
  writeFileSync(STATE_FILE, JSON.stringify({ name: db.name, serverUrl, redisPrefix, s3Prefix }));
}
