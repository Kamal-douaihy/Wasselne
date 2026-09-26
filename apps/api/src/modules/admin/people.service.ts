import { Inject, Injectable } from "@nestjs/common";
import { Kysely, Transaction, sql } from "kysely";
import { ApiError } from "../../common/api-error";
import { PageQuery, decodeCursor, encodeCursor } from "../../common/cursor";
import { DB } from "../../db/db.module";
import { Database } from "../../db/schema-types";
import { TODAY_BEIRUT } from "../drivers/document-expiry.service";
import { EligibilityService } from "../drivers/eligibility.service";
import { OnboardingService } from "../drivers/onboarding.service";
import { AdminContext } from "./admin.guard";
import { AuditService } from "./audit.service";

type Trx = Transaction<Database>;
type App = "RIDER" | "DRIVER";

const ACTIVE_RIDE = ["SEARCHING", "CONFIRMED", "AT_PICKUP", "IN_PROGRESS"];
const EXPIRY_WARNING_DAYS = 30; // proposal; a CMS parameter later (register TBD-4-05)

const iso = (v: unknown): string => new Date(v as string).toISOString();

@Injectable()
export class PeopleService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(EligibilityService) private readonly eligibility: EligibilityService,
    @Inject(OnboardingService) private readonly onboarding: OnboardingService,
  ) {}

  // ------------------------------------------------------------------ blocks (D-34, D-41)

  private blockedFlags(accountId: unknown, app: App) {
    return [
      sql<boolean>`exists (select 1 from account_blocks b where b.account_id = ${accountId} and b.lifted_at is null
        and b.effective_at is not null and b.effective_at <= now() and ${app}::app_kind = any (b.applies_to))`.as("blocked"),
      sql<boolean>`exists (select 1 from account_blocks b where b.account_id = ${accountId} and b.lifted_at is null
        and b.effective_at is null and ${app}::app_kind = any (b.applies_to))`.as("block_pending"),
    ] as const;
  }

  private async hasActiveRide(trx: Trx, accountId: string, app: App): Promise<boolean> {
    if (app === "RIDER") {
      const r = await trx.selectFrom("rides").select("id").where("rider_id", "=", accountId).where("status", "in", ACTIVE_RIDE).executeTakeFirst();
      return Boolean(r);
    }
    const r = await trx.selectFrom("ride_assignments").select("id").where("driver_id", "=", accountId).where("ended_at", "is", null).executeTakeFirst();
    return Boolean(r);
  }

  private async revokeSessions(trx: Trx, accountId: string, apps: App[], reason: string): Promise<void> {
    await trx
      .updateTable("sessions")
      .set({ revoked_at: sql`now()` as never, revoke_reason: reason })
      .where("account_id", "=", accountId)
      .where("revoked_at", "is", null)
      .where("app", "in", apps)
      .execute();
  }

  /**
   * Called by the ride-terminal transaction (Phase 7) so a block queued during a trip takes
   * effect when the trip ends. Exposed and tested now so that hook has nothing left to invent.
   */
  async applyPendingBlocks(trx: Trx, accountId: string): Promise<number> {
    const pending = await trx
      .updateTable("account_blocks")
      .set({ effective_at: sql`now()` as never })
      .where("account_id", "=", accountId)
      .where("lifted_at", "is", null)
      .where("effective_at", "is", null)
      .returning(sql<string[]>`applies_to::text[]`.as("applies_to"))
      .execute();
    for (const p of pending) await this.revokeSessions(trx, accountId, p.applies_to as App[], "BLOCKED");
    return pending.length;
  }

  async block(admin: AdminContext, accountId: string, subject: App, appliesTo: App[], reason: string) {
    return this.db.transaction().execute(async (trx) => {
      await this.requireSubject(trx, accountId, subject, true);
      const apps = [...new Set(appliesTo)];

      // Already blocked for every requested app: report the current state, change nothing.
      const existing = await trx
        .selectFrom("account_blocks")
        .select([sql<string[]>`applies_to::text[]`.as("applies_to"), "effective_at"])
        .where("account_id", "=", accountId)
        .where("lifted_at", "is", null)
        .execute();
      const covered = (a: App, pending: boolean) => existing.some((b) => b.applies_to.includes(a) && (b.effective_at === null) === pending);
      if (apps.every((a) => covered(a, false) || covered(a, true))) {
        const eff = existing.find((b) => b.effective_at !== null)?.effective_at;
        const pending = !eff;
        return { applied: !pending, effective_at: eff ? iso(eff) : null, pending_until_trip_end: pending };
      }

      let activeRide = false;
      for (const a of apps) activeRide ||= await this.hasActiveRide(trx, accountId, a);
      const row = await trx
        .insertInto("account_blocks")
        .values({
          account_id: accountId,
          applies_to: sql`${apps}::app_kind[]` as never,
          reason,
          created_by: admin.id,
          lifted_at: null,
          lifted_by: null,
          lift_reason: null,
          effective_at: activeRide ? null : (sql`now()` as never),
        })
        .returning(["id", "effective_at"])
        .executeTakeFirstOrThrow();
      if (!activeRide) await this.revokeSessions(trx, accountId, apps, "BLOCKED");
      await this.audit.record(trx, admin, {
        action: "account.block",
        targetType: "account",
        targetId: accountId,
        reason,
        before: { blocked: false },
        after: { block_id: row.id, applies_to: apps, pending_until_trip_end: activeRide },
      });
      return { applied: !activeRide, effective_at: row.effective_at ? iso(row.effective_at) : null, pending_until_trip_end: activeRide };
    });
  }

  async unblock(admin: AdminContext, accountId: string, subject: App, reason: string): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      await this.requireSubject(trx, accountId, subject, true);
      const lifted = await trx
        .updateTable("account_blocks")
        .set({ lifted_at: sql`now()` as never, lifted_by: admin.id, lift_reason: reason })
        .where("account_id", "=", accountId)
        .where("lifted_at", "is", null)
        .where(sql<boolean>`${subject}::app_kind = any (applies_to)`)
        .returning(["id", "applies_to", "effective_at"])
        .execute();
      if (lifted.length === 0) return; // nothing was blocked: no mutation, so no audit row
      await this.audit.record(trx, admin, {
        action: "account.unblock",
        targetType: "account",
        targetId: accountId,
        reason,
        before: { block_ids: lifted.map((l) => l.id) },
        after: { blocked: false },
      });
    });
  }

  /** Locks the account (serialises concurrent admin actions on it) and checks it plays the role. */
  private async requireSubject(trx: Trx, accountId: string, subject: App, lock = false) {
    let q = trx.selectFrom("accounts").select(["id", "gender", "gender_confirmed_at"]).where("id", "=", accountId);
    if (lock) q = q.forUpdate();
    const a = await q.executeTakeFirst();
    const profile =
      subject === "RIDER"
        ? await trx.selectFrom("rider_profiles").select("account_id").where("account_id", "=", accountId).executeTakeFirst()
        : await trx.selectFrom("driver_profiles").select("account_id").where("account_id", "=", accountId).executeTakeFirst();
    if (!a || !profile) throw new ApiError(404, "NOT_FOUND", `Unknown ${subject.toLowerCase()}.`);
    return a;
  }

  // ------------------------------------------------------------------ gender (D-39)

  async confirmGender(admin: AdminContext, accountId: string, subject: App, gender: "FEMALE" | "MALE", reason: string): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const before = await this.requireSubject(trx, accountId, subject, true);
      if (subject === "RIDER") {
        const done = await trx.selectFrom("rides").select("id").where("rider_id", "=", accountId).where("status", "=", "COMPLETED").limit(1).executeTakeFirst();
        if (!done) throw new ApiError(409, "INVALID_STATE", "Gender is confirmed after the rider's first completed ride.");
      }
      await trx
        .updateTable("accounts")
        .set({ gender, gender_confirmed_at: sql`now()` as never, gender_confirmed_by: admin.id })
        .where("id", "=", accountId)
        .execute();
      await this.audit.record(trx, admin, {
        action: `${subject.toLowerCase()}.gender_confirm`,
        targetType: "account",
        targetId: accountId,
        reason,
        before: { gender: before.gender, confirmed: before.gender_confirmed_at !== null },
        after: { gender, confirmed: true },
      });
    });
  }

  // ------------------------------------------------------------------ riders

  async listRiders(q: PageQuery) {
    const cur = decodeCursor<{ t: string; id: string }>(q.cursor, ["t", "id"]);
    let query = this.db
      .selectFrom("accounts as a")
      .innerJoin("rider_profiles as rp", "rp.account_id", "a.id")
      .select([
        "a.id", "a.first_name", "a.last_name", "a.phone_e164", "a.gender", "a.gender_confirmed_at", "a.status", "a.created_at", "rp.rating_avg_bp",
        sql<string>`a.created_at::text`.as("cursor_t"),
        sql<number>`(select count(*) from rides r where r.rider_id = a.id and r.status = 'COMPLETED')::int`.as("trip_count"),
        ...this.blockedFlags(sql.ref("a.id"), "RIDER"),
      ])
      .orderBy("a.created_at", "desc")
      .orderBy("a.id", "desc")
      .limit(q.limit + 1);
    if (q.q) {
      const like = `%${q.q.replace(/[%_\\]/g, "\\$&")}%`;
      query = query.where((eb) => eb.or([eb("a.first_name", "ilike", like), eb("a.last_name", "ilike", like), eb("a.phone_e164", "ilike", like)]));
    }
    if (cur) query = query.where(sql<boolean>`(a.created_at, a.id) < (${cur.t}::timestamptz, ${cur.id}::uuid)`);
    const rows = await query.execute();
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    return {
      items: page.map((r) => this.riderItem(r)),
      next_cursor: rows.length > q.limit && last ? encodeCursor({ t: last.cursor_t, id: last.id }) : null,
    };
  }

  private riderItem(r: {
    id: string; first_name: string | null; last_name: string | null; phone_e164: string; gender: "FEMALE" | "MALE" | null;
    gender_confirmed_at: unknown; status: "ACTIVE" | "DELETED"; created_at: unknown; rating_avg_bp: number | null;
    trip_count: number; blocked: boolean; block_pending: boolean;
  }) {
    return {
      id: r.id,
      first_name: r.first_name,
      last_name: r.last_name,
      phone_e164: r.phone_e164,
      ...(r.gender ? { declared_gender: r.gender } : {}),
      gender_confirmed: r.gender_confirmed_at !== null,
      trip_count: r.trip_count,
      rating_avg: r.rating_avg_bp === null ? null : r.rating_avg_bp / 100,
      status: r.status,
      blocked: r.blocked,
      block_pending: r.block_pending,
      created_at: iso(r.created_at),
    };
  }

  async getRider(id: string) {
    const r = await this.db
      .selectFrom("accounts as a")
      .innerJoin("rider_profiles as rp", "rp.account_id", "a.id")
      .select([
        "a.id", "a.first_name", "a.last_name", "a.phone_e164", "a.gender", "a.gender_confirmed_at", "a.status", "a.created_at", "a.email", "rp.rating_avg_bp",
        sql<number>`(select count(*) from rides r where r.rider_id = a.id and r.status = 'COMPLETED')::int`.as("trip_count"),
        ...this.blockedFlags(sql.ref("a.id"), "RIDER"),
      ])
      .where("a.id", "=", id)
      .executeTakeFirst();
    if (!r) throw new ApiError(404, "NOT_FOUND", "Unknown rider.");
    const rides = await sql<{ id: string; status: string; requested_at: string; destination_text: string | null; names: unknown }>`
      select id, status, requested_at, dropoff_text as destination_text, category_snapshot->'names' as names
        from rides where rider_id = ${id}::uuid order by requested_at desc limit 10`.execute(this.db);
    return {
      ...this.riderItem(r),
      email: r.email,
      recent_rides: rides.rows.map((x) => ({
        id: x.id,
        status: x.status,
        ...(x.names ? { category_name: x.names } : {}),
        destination_text: x.destination_text,
        requested_at: iso(x.requested_at),
      })),
    };
  }

  // ------------------------------------------------------------------ drivers

  private async documentStatus(driverId: string): Promise<"COMPLETE" | "INCOMPLETE" | "EXPIRING" | "EXPIRED"> {
    const required = await this.onboarding.requiredTypes(this.db, driverId);
    const docs = await this.onboarding.listDocuments(this.db, driverId);
    const profile = await this.db.selectFrom("driver_profiles").select("current_vehicle_id").where("account_id", "=", driverId).executeTakeFirst();
    const today = (await sql<{ d: string }>`select ${TODAY_BEIRUT} as d`.execute(this.db)).rows[0]!.d;
    const soon = (await sql<{ d: string }>`select (${TODAY_BEIRUT} + ${EXPIRY_WARNING_DAYS}::int) as d`.execute(this.db)).rows[0]!.d;
    if (docs.some((d) => d.status === "EXPIRED")) return "EXPIRED";
    if (required.length === 0) return "INCOMPLETE";
    let expiring = false;
    for (const t of required) {
      const d = docs.find((x) => x.document_type_id === t.id && (t.subject === "DRIVER" ? x.vehicle_id === null : x.vehicle_id === profile?.current_vehicle_id));
      if (!d || d.status !== "APPROVED") return "INCOMPLETE";
      if (d.expires_on && d.expires_on >= today && d.expires_on <= soon) expiring = true;
    }
    return expiring ? "EXPIRING" : "COMPLETE";
  }

  private async driverItem(r: {
    id: string; first_name: string | null; last_name: string | null; phone_e164: string; status: string; rating_avg_bp: number | null;
    plate: string | null; blocked: boolean; block_pending: boolean; check_status: string | null;
  }) {
    const cats = await sql<{ code: string }>`
      select c.code from driver_category_approvals a join vehicle_categories c on c.id = a.category_id
       where a.driver_id = ${r.id}::uuid and a.status = 'APPROVED' order by c.code`.execute(this.db);
    return {
      id: r.id,
      first_name: r.first_name,
      last_name: r.last_name,
      phone_e164: r.phone_e164,
      qualified_categories: cats.rows.map((c) => c.code),
      vehicle_plate: r.plate,
      document_status: await this.documentStatus(r.id),
      ...(r.check_status ? { vehicle_check_status: r.check_status } : {}),
      wallet_balances: [] as unknown[], // ledger arrives in Phase 8
      rating_avg: r.rating_avg_bp === null ? null : r.rating_avg_bp / 100,
      status: r.status,
      blocked: r.blocked,
      block_pending: r.block_pending,
    };
  }

  private driverSelect() {
    return this.db
      .selectFrom("driver_profiles as dp")
      .innerJoin("accounts as a", "a.id", "dp.account_id")
      .leftJoin("vehicles as v", "v.id", "dp.current_vehicle_id")
      .select([
        "a.id", "a.first_name", "a.last_name", "a.phone_e164", "a.created_at", "a.gender", "a.gender_confirmed_at", "dp.status", "dp.rating_avg_bp", "v.plate",
        sql<string>`a.created_at::text`.as("cursor_t"),
        sql<string | null>`(select c.status from vehicle_checks c where c.vehicle_id = dp.current_vehicle_id order by c.due_on desc limit 1)`.as("check_status"),
        ...this.blockedFlags(sql.ref("a.id"), "DRIVER"),
      ]);
  }

  async listDrivers(q: PageQuery) {
    const cur = decodeCursor<{ t: string; id: string }>(q.cursor, ["t", "id"]);
    let query = this.driverSelect().orderBy("a.created_at", "desc").orderBy("a.id", "desc").limit(q.limit + 1);
    if (q.q) {
      const like = `%${q.q.replace(/[%_\\]/g, "\\$&")}%`;
      query = query.where((eb) => eb.or([eb("a.first_name", "ilike", like), eb("a.last_name", "ilike", like), eb("a.phone_e164", "ilike", like), eb("v.plate", "ilike", like)]));
    }
    if (cur) query = query.where(sql<boolean>`(a.created_at, a.id) < (${cur.t}::timestamptz, ${cur.id}::uuid)`);
    const rows = await query.execute();
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    return {
      items: await Promise.all(page.map((r) => this.driverItem(r))),
      next_cursor: rows.length > q.limit && last ? encodeCursor({ t: last.cursor_t, id: last.id }) : null,
    };
  }

  async getDriver(id: string) {
    const r = await this.driverSelect().where("a.id", "=", id).executeTakeFirst();
    if (!r) throw new ApiError(404, "NOT_FOUND", "Unknown driver.");
    const vehicles = await this.db.selectFrom("vehicles").selectAll().where("driver_id", "=", id).orderBy("created_at", "desc").execute();
    const categories = await sql<{ category_id: string; code: string; status: string; reason: string | null }>`
      select a.category_id, c.code, a.status, a.reason from driver_category_approvals a
        join vehicle_categories c on c.id = a.category_id where a.driver_id = ${id}::uuid order by c.code`.execute(this.db);
    return {
      ...(await this.driverItem(r)),
      ...(r.gender ? { declared_gender: r.gender } : {}),
      gender_confirmed: r.gender_confirmed_at !== null,
      category_approvals: categories.rows,
      vehicles: vehicles.map((v) => ({ base_type: v.base_type, make: v.make, model: v.model, year: v.year, color: v.color, plate: v.plate, seats: v.seats })),
      documents: await this.onboarding.listDocuments(this.db, id),
    };
  }

  private async lockDriver(trx: Trx, id: string) {
    const p = await trx.selectFrom("driver_profiles").selectAll().where("account_id", "=", id).forUpdate().executeTakeFirst();
    if (!p) throw new ApiError(404, "NOT_FOUND", "Unknown driver.");
    return p;
  }

  async suspend(admin: AdminContext, id: string, reason: string): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const p = await this.lockDriver(trx, id);
      if (p.status !== "APPROVED") throw new ApiError(409, "INVALID_STATE", `Only an approved driver can be suspended (status is ${p.status}).`, { status: p.status });
      await trx.updateTable("driver_profiles").set({ status: "SUSPENDED", status_reason: reason }).where("account_id", "=", id).execute();
      await this.audit.record(trx, admin, { action: "driver.suspend", targetType: "driver", targetId: id, reason, before: { status: p.status }, after: { status: "SUSPENDED" } });
    });
  }

  async reinstate(admin: AdminContext, id: string, reason: string): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const p = await this.lockDriver(trx, id);
      if (p.status !== "SUSPENDED") throw new ApiError(409, "INVALID_STATE", `Only a suspended driver can be reinstated (status is ${p.status}).`, { status: p.status });
      await trx.updateTable("driver_profiles").set({ status: "APPROVED", status_reason: null }).where("account_id", "=", id).execute();
      await this.audit.record(trx, admin, { action: "driver.reinstate", targetType: "driver", targetId: id, reason, before: { status: p.status }, after: { status: "APPROVED" } });
    });
  }

  /** Reasons that come from the driver's account state rather than the category's own requirements. */
  private static readonly ACCOUNT_LEVEL = new Set(["DRIVER_NOT_APPROVED", "ACCOUNT_BLOCKED", "BLOCK_PENDING", "ACCOUNT_NOT_ACTIVE"]);

  async editCategory(admin: AdminContext, id: string, categoryId: string, status: "PENDING" | "APPROVED" | "REJECTED" | "PAUSED_BY_DRIVER", reason: string): Promise<void> {
    if (status === "PAUSED_BY_DRIVER") throw new ApiError(400, "VALIDATION_FAILED", "Pausing a category is the driver's own action.", { issues: [{ path: "status", message: "driver-controlled" }] });
    await this.db.transaction().execute(async (trx) => {
      const p = await this.lockDriver(trx, id);
      const row = await trx.selectFrom("driver_category_approvals").selectAll().where("driver_id", "=", id).where("category_id", "=", categoryId).executeTakeFirst();
      if (!row) throw new ApiError(404, "NOT_FOUND", "The driver has not applied for this category.");
      if (status === "APPROVED" && !["APPROVED", "SUSPENDED"].includes(p.status)) {
        throw new ApiError(409, "INVALID_STATE", "Approve the driver's application first.", { status: p.status });
      }
      await trx
        .updateTable("driver_category_approvals")
        .set({ status, reason, decided_by: admin.id, decided_at: sql`now()` as never })
        .where("driver_id", "=", id)
        .where("category_id", "=", categoryId)
        .execute();
      if (status === "APPROVED") {
        const blocking = (await this.eligibility.reasons(id, categoryId, trx)).filter((x) => !PeopleService.ACCOUNT_LEVEL.has(x));
        if (blocking.length > 0) throw new ApiError(409, "INVALID_STATE", "The category's requirements are not met.", { reasons: blocking });
      }
      await this.audit.record(trx, admin, {
        action: "driver.category_edit",
        targetType: "driver",
        targetId: id,
        reason,
        before: { category_id: categoryId, status: row.status },
        after: { category_id: categoryId, status },
      });
    });
  }
}
