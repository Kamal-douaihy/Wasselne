import { existsSync, readFileSync, unlinkSync } from "node:fs";
import Redis from "ioredis";
import { config as loadDotenv } from "dotenv";
import { STATE_FILE } from "./global-setup";

export default async function globalTeardown(): Promise<void> {
  loadDotenv();
  if (!existsSync(STATE_FILE)) return;
  const state = JSON.parse(readFileSync(STATE_FILE, "utf8")) as { name: string; serverUrl: string; redisPrefix: string; s3Prefix?: string };
  unlinkSync(STATE_FILE);

  // Rebuild a handle to the same database name to drop it.
  const handle = await createTempDatabaseHandle(state.serverUrl, state.name);
  await handle.drop();

  const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
  const keys = await redis.keys(`${state.redisPrefix}*`);
  if (keys.length) await redis.del(...keys);
  redis.disconnect();

  if (state.s3Prefix) await deleteS3Prefix(state.s3Prefix);
}

async function deleteS3Prefix(prefix: string): Promise<void> {
  const { S3Client, ListObjectsV2Command, DeleteObjectsCommand } = await import("@aws-sdk/client-s3");
  const client = new S3Client({
    region: process.env.S3_REGION ?? "us-east-1",
    endpoint: process.env.S3_ENDPOINT ?? "http://localhost:9000",
    forcePathStyle: true,
    credentials: { accessKeyId: process.env.S3_ACCESS_KEY ?? "wasselne", secretAccessKey: process.env.S3_SECRET_KEY ?? "wasselne_local_key" },
  });
  const Bucket = process.env.S3_BUCKET ?? "wasselne-local";
  const listed = await client.send(new ListObjectsV2Command({ Bucket, Prefix: prefix }));
  if (listed.Contents?.length) {
    await client.send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: listed.Contents.map((o) => ({ Key: o.Key! })) } }));
  }
  client.destroy();
}

async function createTempDatabaseHandle(serverUrl: string, name: string) {
  const { Pool } = await import("pg");
  const u = new URL(serverUrl);
  u.pathname = "/postgres";
  return {
    async drop() {
      const pool = new Pool({ connectionString: u.toString(), max: 1 });
      try {
        await pool.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      } finally {
        await pool.end();
      }
    },
  };
}
