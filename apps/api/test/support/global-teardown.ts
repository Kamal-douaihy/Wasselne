import { existsSync, readFileSync, unlinkSync } from "node:fs";
import Redis from "ioredis";
import { config as loadDotenv } from "dotenv";
import { STATE_FILE } from "./global-setup";

export default async function globalTeardown(): Promise<void> {
  loadDotenv();
  if (!existsSync(STATE_FILE)) return;
  const state = JSON.parse(readFileSync(STATE_FILE, "utf8")) as { name: string; serverUrl: string; redisPrefix: string };
  unlinkSync(STATE_FILE);

  // Rebuild a handle to the same database name to drop it.
  const handle = await createTempDatabaseHandle(state.serverUrl, state.name);
  await handle.drop();

  const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
  const keys = await redis.keys(`${state.redisPrefix}*`);
  if (keys.length) await redis.del(...keys);
  redis.disconnect();
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
