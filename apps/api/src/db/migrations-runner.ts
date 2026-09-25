import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";

// Repo-root db/migrations, from both src/db and dist/db.
export const MIGRATIONS_DIR = join(__dirname, "..", "..", "..", "..", "db", "migrations");

// Plain-SQL migration runner (docs/phase-2/01_Architecture.md §4). Each file runs in its own
// transaction and is recorded in schema_migrations; a session advisory lock stops two runners
// (e.g. parallel CI jobs pointed at one database) from interleaving.
export async function runMigrations(databaseUrl: string, log: (line: string) => void = () => undefined): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(727001)");
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
    const { rows } = await client.query<{ filename: string }>("SELECT filename FROM schema_migrations");
    const applied = new Set(rows.map((r) => r.filename));

    for (const file of files) {
      if (applied.has(file)) {
        log(`skip  ${file} (already applied)`);
        continue;
      }
      try {
        await client.query("BEGIN");
        await client.query(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
        await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [file]);
        await client.query("COMMIT");
        log(`apply ${file}`);
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`, { cause: err });
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(727001)").catch(() => undefined);
    client.release();
    await pool.end();
  }
}
