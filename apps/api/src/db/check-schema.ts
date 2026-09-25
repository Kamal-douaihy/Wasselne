// Schema gate (runs locally and in CI):
//  1. load docs/phase-2/schema.sql into a fresh database and run schema-invariants-test.sql; any
//     invariant that is not rejected (or rejected for the wrong reason) makes this process exit 1;
//  2. prove the gate can fail: drop one enforcing index and require the invariants to fail;
//  3. apply db/migrations to another fresh database and require an identical structure to (1),
//     so the migrations cannot drift from the reviewed schema.
import { config as loadDotenv } from "dotenv";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { runMigrations } from "./migrations-runner";
import { createTempDatabase } from "./temp-database";

loadDotenv();
const DOCS = join(__dirname, "..", "..", "..", "..", "docs", "phase-2");
const schemaSql = readFileSync(join(DOCS, "schema.sql"), "utf8");
const invariantsSql = readFileSync(join(DOCS, "schema-invariants-test.sql"), "utf8");
const EXPECTED_CHECKS = (invariantsSql.match(/SELECT expect_fail\(/g) ?? []).length;

async function withClient<T>(url: string, fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

async function runInvariants(url: string): Promise<{ passes: number; error?: string }> {
  return withClient(url, async (c) => {
    let passes = 0;
    c.on("notice", (n) => {
      if (n.message?.startsWith("PASS:")) passes += 1;
      console.log("  " + n.message);
    });
    try {
      await c.query(invariantsSql);
      return { passes };
    } catch (err) {
      return { passes, error: (err as Error).message };
    }
  });
}

async function fingerprint(url: string): Promise<string> {
  return withClient(url, async (c) => {
    const q = async (sql: string) => (await c.query(sql)).rows;
    return JSON.stringify({
      columns: await q(`SELECT table_name, ordinal_position, column_name, udt_name, is_nullable, column_default
        FROM information_schema.columns WHERE table_schema='public' AND table_name <> 'schema_migrations'
        ORDER BY 1,2`),
      constraints: await q(`SELECT conrelid::regclass::text AS t, conname, pg_get_constraintdef(oid) AS def
        FROM pg_constraint WHERE connamespace='public'::regnamespace AND conrelid::regclass::text <> 'schema_migrations'
        ORDER BY 1,2`),
      indexes: await q(`SELECT tablename, indexname, indexdef FROM pg_indexes
        WHERE schemaname='public' AND tablename <> 'schema_migrations' ORDER BY 1,2`),
      triggers: await q(`SELECT tgrelid::regclass::text AS t, tgname, pg_get_triggerdef(oid) AS def
        FROM pg_trigger WHERE NOT tgisinternal ORDER BY 1,2`),
      functions: await q(`SELECT proname, pg_get_functiondef(oid) AS def FROM pg_proc
        WHERE pronamespace='public'::regnamespace AND proname NOT LIKE 'expect_fail' AND prokind='f'
        AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = pg_proc.oid AND d.deptype='e') ORDER BY 1`),
    });
  });
}

async function main(): Promise<void> {
  const server = process.env.DATABASE_URL;
  if (!server) throw new Error("DATABASE_URL must point at a PostgreSQL server (a temporary database is created).");
  const dbs = [];
  let failed = false;
  const fail = (msg: string) => {
    console.error(`FAIL: ${msg}`);
    failed = true;
  };
  try {
    const a = await createTempDatabase(server, "wasselne_schema_a");
    dbs.push(a);
    await withClient(a.url, (c) => c.query(schemaSql));
    const fpSchema = await fingerprint(a.url);

    console.log(`1) invariants on schema.sql (${EXPECTED_CHECKS} checks expected)`);
    const good = await runInvariants(a.url);
    if (good.error) fail(good.error);
    else if (good.passes !== EXPECTED_CHECKS) fail(`expected ${EXPECTED_CHECKS} PASS lines, saw ${good.passes}`);

    console.log("2) self-test: the gate must fail when an enforcing index is removed");
    const b = await createTempDatabase(server, "wasselne_schema_b");
    dbs.push(b);
    await withClient(b.url, async (c) => {
      await c.query(schemaSql);
      await c.query("DROP INDEX one_outstanding_offer_per_ride");
    });
    const mutated = await runInvariants(b.url);
    if (!mutated.error) fail("self-test: invariants still passed with one_outstanding_offer_per_ride dropped");
    else if (!mutated.error.includes("statement succeeded")) fail(`self-test failed for the wrong reason: ${mutated.error}`);
    else console.log(`  gate correctly failed: ${mutated.error}`);

    console.log("3) migrations vs schema.sql structure");
    const c = await createTempDatabase(server, "wasselne_schema_c");
    dbs.push(c);
    await runMigrations(c.url);
    const fpMigrations = await fingerprint(c.url);
    if (fpSchema !== fpMigrations) {
      const s = JSON.parse(fpSchema) as Record<string, unknown[]>;
      const m = JSON.parse(fpMigrations) as Record<string, unknown[]>;
      for (const k of Object.keys(s)) {
        const only = (x: unknown[], y: unknown[]) => x.filter((r) => !y.some((q) => JSON.stringify(q) === JSON.stringify(r)));
        for (const r of only(s[k]!, m[k]!)) console.error(`  only in schema.sql [${k}]: ${JSON.stringify(r)}`);
        for (const r of only(m[k]!, s[k]!)) console.error(`  only in migrations [${k}]: ${JSON.stringify(r)}`);
      }
      fail("db/migrations produce a different structure than docs/phase-2/schema.sql");
    } else console.log("  identical");
  } finally {
    for (const d of dbs) await d.drop();
  }
  if (failed) process.exit(1);
  console.log("schema gate: OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
