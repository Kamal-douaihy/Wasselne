import { randomBytes } from "node:crypto";
import { Pool } from "pg";

function withDatabase(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

export interface TempDatabase {
  name: string;
  url: string;
  drop(): Promise<void>;
}

// Creates an empty, uniquely named database on the server DATABASE_URL points at (via its
// maintenance `postgres` database) so tests and checks never touch the developer's data.
export async function createTempDatabase(serverUrl: string, prefix: string): Promise<TempDatabase> {
  const name = `${prefix}_${randomBytes(4).toString("hex")}`;
  const admin = new Pool({ connectionString: withDatabase(serverUrl, "postgres"), max: 1 });
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }
  return {
    name,
    url: withDatabase(serverUrl, name),
    async drop() {
      const pool = new Pool({ connectionString: withDatabase(serverUrl, "postgres"), max: 1 });
      try {
        await pool.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      } finally {
        await pool.end();
      }
    },
  };
}
