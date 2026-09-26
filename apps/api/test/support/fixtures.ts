import { authenticator } from "otplib";
import { randomBytes, randomUUID } from "node:crypto";
import { hashPassword, encryptSecret, sha256Hex } from "../../src/modules/admin/admin-crypto";
import { TestContext, call, randomPhone, requestCode } from "./test-app";

// ---------------------------------------------------------------- accounts

export interface Signed {
  accountId: string;
  phone: string;
  token: string;
  refresh: string;
}

export async function signUp(
  ctx: TestContext,
  app: "RIDER" | "DRIVER",
  opts: { gender?: "FEMALE" | "MALE"; phone?: string; legal?: string[] } = {},
): Promise<Signed> {
  const phone = opts.phone ?? randomPhone();
  const { challengeId, code } = await requestCode(ctx, phone, app);
  const v = await call(ctx, "post", "/auth/otp/verify", { body: { challenge_id: challengeId, code } });
  if (v.body.status !== "NEEDS_PROFILE") throw new Error("expected a new account");
  const created = await call(ctx, "post", "/me/complete-profile", {
    token: v.body.needs_profile_token,
    body: { first_name: "Test", last_name: app === "DRIVER" ? "Driver" : "Rider", gender: opts.gender ?? "MALE", accepted_legal_version_ids: opts.legal ?? [] },
  });
  if (created.status !== 201) throw new Error(`complete-profile failed: ${JSON.stringify(created.body)}`);
  const me = await call(ctx, "get", "/me", { token: created.body.access_token });
  return { accountId: me.body.id, phone, token: created.body.access_token, refresh: created.body.refresh_token };
}

export async function signIn(ctx: TestContext, phone: string, app: "RIDER" | "DRIVER"): Promise<Signed> {
  const { challengeId, code } = await requestCode(ctx, phone, app);
  const v = await call(ctx, "post", "/auth/otp/verify", { body: { challenge_id: challengeId, code } });
  if (v.body.status !== "SESSION") throw new Error(`expected a session: ${JSON.stringify(v.body)}`);
  return { accountId: v.body.account_id, phone, token: v.body.session.access_token, refresh: v.body.session.refresh_token };
}

// ---------------------------------------------------------------- admin

export interface TestAdmin {
  id: string;
  email: string;
  password: string;
  totpSecret: string;
  token?: string;
}

export async function createAdmin(ctx: TestContext, roles: string[], opts: { enrolled?: boolean } = {}): Promise<TestAdmin> {
  const email = `admin-${randomBytes(4).toString("hex")}@example.test`;
  const password = `pw-${randomBytes(8).toString("hex")}`;
  const totpSecret = authenticator.generateSecret();
  const enrolled = opts.enrolled ?? true;
  const key = process.env.ADMIN_TOTP_ENC_KEY!;
  const r = await ctx.pool.query(
    `insert into admin_users (email, full_name, password_hash, totp_secret_enc, mfa_enrolled_at) values ($1,$2,$3,$4, ${enrolled ? "now()" : "null"}) returning id`,
    [email, "Test Admin", await hashPassword(password), enrolled ? encryptSecret(totpSecret, key) : null],
  );
  for (const role of roles) await ctx.pool.query("insert into admin_user_roles (admin_id, role_code) values ($1,$2)", [r.rows[0].id, role]);
  return { id: r.rows[0].id, email, password, totpSecret };
}

/** Inserts a verified admin session directly (skips the login round trip; see admin-auth tests for the real flow). */
export async function adminSession(ctx: TestContext, admin: TestAdmin): Promise<string> {
  const token = randomBytes(24).toString("base64url");
  await ctx.pool.query(
    "insert into admin_sessions (admin_id, token_hash, mfa_verified_at, expires_at) values ($1,$2, now(), now() + interval '1 hour')",
    [admin.id, sha256Hex(token)],
  );
  admin.token = token;
  return token;
}

export async function adminWith(ctx: TestContext, roles: string[]): Promise<TestAdmin & { token: string }> {
  const a = await createAdmin(ctx, roles);
  const token = await adminSession(ctx, a);
  return { ...a, token };
}

// ---------------------------------------------------------------- catalog

export interface CategoryOpts {
  code?: string;
  base_type?: "CAR" | "MOTORCYCLE" | "TUKTUK";
  seats?: number;
  women?: boolean;
  active?: boolean;
  min_year?: number;
}

export async function createCategory(ctx: TestContext, o: CategoryOpts = {}): Promise<string> {
  const id = randomUUID();
  await ctx.pool.query(
    `insert into vehicle_categories (id, code, names, base_type, seats, female_drivers_only, female_riders_only, vehicle_rules, icon, active)
     values ($1,$2,$3,$4,$5,$6,$6,$7,'car',$8)`,
    [id, o.code ?? `cat-${id.slice(0, 8)}`, JSON.stringify({ en: "Test category" }), o.base_type ?? "CAR", o.seats ?? 4, o.women ?? false, JSON.stringify(o.min_year ? { min_year: o.min_year } : {}), o.active ?? true],
  );
  return id;
}

export async function createDocType(ctx: TestContext, o: { subject?: "DRIVER" | "VEHICLE"; has_expiry?: boolean; code?: string } = {}): Promise<string> {
  const id = randomUUID();
  await ctx.pool.query("insert into document_types (id, code, names, subject, has_expiry) values ($1,$2,$3,$4,$5)", [
    id, o.code ?? `doc-${id.slice(0, 8)}`, JSON.stringify({ en: "Test doc" }), o.subject ?? "DRIVER", o.has_expiry ?? false,
  ]);
  return id;
}

export async function requireDoc(ctx: TestContext, categoryId: string, docTypeId: string): Promise<void> {
  await ctx.pool.query("insert into category_document_requirements (category_id, document_type_id) values ($1,$2)", [categoryId, docTypeId]);
}

// ---------------------------------------------------------------- uploads

export const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(64)]);
export const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(64)]);

/** authorize -> PUT to the presigned URL (real MinIO) -> complete. Returns the complete() response. */
export async function uploadFile(
  ctx: TestContext,
  token: string,
  bytes: Buffer,
  contentType = "image/jpeg",
  purpose = "DRIVER_DOCUMENT",
) {
  const auth = await call(ctx, "post", "/uploads/authorize", { token, body: { purpose, content_type: contentType, max_bytes: 1_000_000 } });
  if (auth.status !== 201) throw new Error(`authorize failed: ${JSON.stringify(auth.body)}`);
  const put = await fetch(auth.body.put_url, { method: "PUT", headers: auth.body.required_headers, body: bytes });
  if (!put.ok) throw new Error(`PUT to storage failed: ${put.status} ${await put.text()}`);
  const done = await call(ctx, "post", "/uploads/{id}/complete", { token, params: { id: auth.body.upload_id } });
  return { uploadId: auth.body.upload_id as string, authorize: auth, complete: done };
}

// ---------------------------------------------------------------- a driver application

export interface DriverSetup {
  driver: Signed;
  categoryId: string;
  docTypeIds: string[];
}

/**
 * Drives the real onboarding endpoints up to (not including) submit, with one category that
 * requires one driver document (ID) and one vehicle document (registration, with expiry).
 */
export async function onboardDriver(
  ctx: TestContext,
  o: { gender?: "FEMALE" | "MALE"; category?: CategoryOpts; expiresOn?: string; submit?: boolean } = {},
): Promise<DriverSetup> {
  const categoryId = await createCategory(ctx, o.category);
  const idDoc = await createDocType(ctx, { subject: "DRIVER" });
  const regDoc = await createDocType(ctx, { subject: "VEHICLE", has_expiry: true });
  await requireDoc(ctx, categoryId, idDoc);
  await requireDoc(ctx, categoryId, regDoc);

  const driver = await signUp(ctx, "DRIVER", { gender: o.gender ?? "MALE" });
  const t = driver.token;
  const ok = (r: { status: number; body: unknown }, s: number) => {
    if (r.status !== s) throw new Error(`onboarding step failed (${r.status}): ${JSON.stringify(r.body)}`);
  };
  ok(await call(ctx, "post", "/driver/onboarding/profile", { token: t, body: { first_name: "Dana", last_name: "Driver", gender: o.gender ?? "MALE", accepted_legal_version_ids: [] } }), 200);
  ok(
    await call(ctx, "post", "/driver/onboarding/vehicle", {
      token: t,
      body: { base_type: o.category?.base_type ?? "CAR", make: "Kia", model: "Rio", year: 2020, color: "Grey", plate: `T${randomBytes(3).toString("hex").toUpperCase()}`, seats: 4 },
    }),
    200,
  );
  ok(await call(ctx, "post", "/driver/onboarding/categories", { token: t, body: { category_ids: [categoryId] } }), 200);
  const up1 = await uploadFile(ctx, t, JPEG);
  ok(await call(ctx, "post", "/driver/onboarding/documents", { token: t, body: { document_type_id: idDoc, upload_id: up1.uploadId } }), 201);
  const up2 = await uploadFile(ctx, t, PNG, "image/png");
  const future = o.expiresOn ?? new Date(Date.now() + 365 * 86400_000).toISOString().slice(0, 10);
  ok(await call(ctx, "post", "/driver/onboarding/documents", { token: t, body: { document_type_id: regDoc, upload_id: up2.uploadId, expires_on: future } }), 201);
  if (o.submit !== false) ok(await call(ctx, "post", "/driver/onboarding/submit", { token: t }), 200);
  return { driver, categoryId, docTypeIds: [idDoc, regDoc] };
}

export async function approveDriverViaApi(ctx: TestContext, reviewer: { token: string }, driverId: string): Promise<void> {
  const detail = await call(ctx, "get", "/admin/drivers/{id}", { token: reviewer.token, params: { id: driverId } });
  for (const d of detail.body.documents) {
    const r = await call(ctx, "post", "/admin/driver-approvals/{id}/documents/{documentId}/approve", {
      token: reviewer.token, params: { id: driverId, documentId: d.id }, body: { reason: "looks fine" },
    });
    if (r.status !== 200) throw new Error(`doc approve failed: ${JSON.stringify(r.body)}`);
  }
  const r = await call(ctx, "post", "/admin/driver-approvals/{id}/approve", { token: reviewer.token, params: { id: driverId }, body: { reason: "all documents verified" } });
  if (r.status !== 200) throw new Error(`driver approve failed: ${r.status} ${JSON.stringify(r.body)}`);
}

// ---------------------------------------------------------------- rides (rows only, no dispatch)

/** Inserts the quote + ride rows a test needs directly; dispatch itself arrives in Phase 6. */
export async function createRide(ctx: TestContext, riderId: string, categoryId: string, status = "SEARCHING"): Promise<string> {
  const zone = (await ctx.pool.query("insert into service_zones (code, name) values ($1,'Z') returning id", [`z-${randomUUID().slice(0, 8)}`])).rows[0].id;
  const settings = (await ctx.pool.query("insert into platform_settings_versions (settings, status) values ('{}','DRAFT') returning id")).rows[0].id;
  const quote = (
    await ctx.pool.query(
      `insert into quotes (rider_id, category_id, zone_id, pickup, dropoff, route_distance_m, route_duration_s, settings_version_id, expires_at)
       values ($1,$2,$3,'POINT(35.5 33.89)','POINT(35.52 33.9)',3000,600,$4, now() + interval '5 minutes') returning id`,
      [riderId, categoryId, zone, settings],
    )
  ).rows[0].id;
  return (
    await ctx.pool.query(
      `insert into rides (rider_id, quote_id, request_idempotency_key, category_id, category_snapshot, zone_id, pickup, dropoff, settings_version_id, fare_mode, commission_counted, search_deadline_at, status)
       values ($1,$2,$3,$4,'{}',$5,'POINT(35.5 33.89)','POINT(35.52 33.9)',$6,'FIXED',false, now() + interval '2 minutes', $7) returning id`,
      [riderId, quote, randomUUID(), categoryId, zone, settings, status],
    )
  ).rows[0].id;
}
