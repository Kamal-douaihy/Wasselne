// Creates (or resets the password of) an admin account from the command line, because the
// console has no self-sign-up. There are no default credentials.
//   ADMIN_PASSWORD='...' pnpm --filter @wasselne/api run admin:create -- --email a@b.c --name "Full Name" --role SUPER_ADMIN
// The password comes from the environment so it stays out of shell history and process lists.
import { config as loadDotenv } from "dotenv";
import { Pool } from "pg";
import { hashPassword } from "../modules/admin/admin-crypto";

loadDotenv();

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const email = arg("email")?.trim().toLowerCase();
  const name = arg("name");
  const role = arg("role");
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !name || !role || !password) {
    throw new Error("Usage: ADMIN_PASSWORD=... admin:create --email <email> --name <full name> --role <ROLE_CODE>");
  }
  if (password.length < 12) throw new Error("ADMIN_PASSWORD must be at least 12 characters.");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const roleRow = await pool.query("select code from admin_roles where code = $1", [role]);
    if (roleRow.rowCount === 0) throw new Error(`Unknown role ${role}.`);
    const hash = await hashPassword(password);
    const res = await pool.query(
      `insert into admin_users (email, full_name, password_hash) values ($1, $2, $3)
       on conflict (email) do update set password_hash = excluded.password_hash, full_name = excluded.full_name
       returning id`,
      [email, name, hash],
    );
    await pool.query(`insert into admin_user_roles (admin_id, role_code) values ($1, $2) on conflict do nothing`, [res.rows[0].id, role]);
    console.log(`admin ${email} ready with role ${role}; MFA enrolment happens at first sign-in.`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exit(1);
});
