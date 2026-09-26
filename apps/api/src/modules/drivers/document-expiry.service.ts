import { Inject, Injectable, Logger } from "@nestjs/common";
import { Kysely, sql } from "kysely";
import { DB } from "../../db/db.module";
import { Database } from "../../db/schema-types";

/** Calendar date in Lebanon. The timezone is an assumption (register TBD-4-01). */
export const TODAY_BEIRUT = sql<string>`(now() at time zone 'Asia/Beirut')::date`;

@Injectable()
export class DocumentExpiryService {
  private readonly logger = new Logger(DocumentExpiryService.name);
  constructor(@Inject(DB) private readonly db: Kysely<Database>) {}

  /**
   * Marks documents past their expiry date as EXPIRED. Eligibility does not depend on this job
   * (driver_ineligibility_reasons compares dates itself); the job keeps stored status, admin lists
   * and driver checklists honest. Idempotent, safe to run from several workers.
   */
  async expireDue(): Promise<number> {
    const res = await this.db
      .updateTable("driver_documents")
      .set({ status: "EXPIRED" })
      .where("status", "in", ["UPLOADED", "APPROVED"])
      .where("expires_on", "<", TODAY_BEIRUT as never)
      .executeTakeFirst();
    const n = Number(res.numUpdatedRows);
    if (n > 0) this.logger.log(`expired ${n} driver document(s)`);
    return n;
  }
}
