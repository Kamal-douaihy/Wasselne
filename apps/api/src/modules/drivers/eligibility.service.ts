import { Inject, Injectable } from "@nestjs/common";
import { Kysely, Transaction, sql } from "kysely";
import { ApiError } from "../../common/api-error";
import { DB } from "../../db/db.module";
import { Database } from "../../db/schema-types";

type Db = Kysely<Database> | Transaction<Database>;

/**
 * Thin wrapper over driver_ineligibility_reasons() (db/migrations/020, 021). The rule lives in
 * PostgreSQL so the same answer applies in dispatch transactions and, through the ride_offers
 * trigger, to every offer row ever inserted. Live state (online, outstanding offer, debt limit,
 * fresh presence) is layered on by dispatch in Phase 6.
 */
@Injectable()
export class EligibilityService {
  constructor(@Inject(DB) private readonly db: Kysely<Database>) {}

  async reasons(driverId: string, categoryId: string, db: Db = this.db): Promise<string[]> {
    const res = await sql<{ r: string[] }>`select driver_ineligibility_reasons(${driverId}::uuid, ${categoryId}::uuid) as r`.execute(db);
    return res.rows[0]?.r ?? ["DRIVER_NOT_FOUND"];
  }

  /** vehicle_category_fit_reasons(): VEHICLE_TYPE, SEATS, VEHICLE_YEAR; empty = the vehicle fits. */
  async vehicleFit(vehicleId: string, categoryId: string, db: Db = this.db): Promise<string[]> {
    const res = await sql<{ r: string[] }>`select vehicle_category_fit_reasons(${vehicleId}::uuid, ${categoryId}::uuid) as r`.execute(db);
    return res.rows[0]?.r ?? ["VEHICLE_NOT_FOUND"];
  }

  async assertEligible(driverId: string, categoryId: string, db: Db = this.db): Promise<void> {
    const reasons = await this.reasons(driverId, categoryId, db);
    if (reasons.length > 0) throw new ApiError(409, "DRIVER_NOT_ELIGIBLE", "Driver is not eligible for this category.", { reasons });
  }

  /** Categories the driver may be offered right now (identity/approval/document rules only). */
  async eligibleCategoryIds(driverId: string, db: Db = this.db): Promise<string[]> {
    const cats = await db.selectFrom("driver_category_approvals").select("category_id").where("driver_id", "=", driverId).execute();
    const out: string[] = [];
    for (const c of cats) {
      if ((await this.reasons(driverId, c.category_id, db)).length === 0) out.push(c.category_id);
    }
    return out;
  }
}
