import { Inject, Injectable, Logger } from "@nestjs/common";
import { Kysely, sql } from "kysely";
import { DB } from "../../db/db.module";
import { Database } from "../../db/schema-types";
import { ObjectStorage } from "../storage/object-storage";

// Same grace as UploadsService.complete(): a grant can still be completed for a few minutes after
// its expiry, so it is only abandoned after that.
const GRACE_S = 600;

@Injectable()
export class UploadCleanupService {
  private readonly logger = new Logger(UploadCleanupService.name);
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(ObjectStorage) private readonly storage: ObjectStorage,
  ) {}

  /**
   * Once a grant's presigned PUT can no longer be used, deletes whatever sits at its staging key
   * and clears staging_object_key. That covers grants never completed (the presigned PUT cannot
   * cap the size itself, so completion is where size is enforced; these are marked EXPIRED) and
   * bytes re-PUT to staging after a completion or rejection. The final object is never touched.
   * Idempotent; safe from several workers (rows are claimed with SKIP LOCKED). Returns the number
   * of abandoned grants expired.
   */
  async sweepAbandoned(): Promise<number> {
    const claimed = await sql<{ staging_key: string; abandoned: boolean }>`
      WITH due AS (
        SELECT id, staging_object_key, status FROM uploads
         WHERE staging_object_key IS NOT NULL AND expires_at < now() - make_interval(secs => ${GRACE_S})
         FOR UPDATE SKIP LOCKED
      )
      UPDATE uploads u
         SET staging_object_key = NULL,
             status = CASE WHEN due.status = 'AUTHORIZED' THEN 'EXPIRED'::upload_status ELSE u.status END
        FROM due
       WHERE u.id = due.id
      RETURNING due.staging_object_key AS staging_key, due.status = 'AUTHORIZED' AS abandoned`.execute(this.db);
    for (const u of claimed.rows) {
      await this.storage.delete(u.staging_key).catch((err: Error) => this.logger.warn(`could not delete ${u.staging_key}: ${err.message}`));
    }
    const abandoned = claimed.rows.filter((u) => u.abandoned).length;
    if (abandoned > 0) this.logger.log(`expired ${abandoned} abandoned upload grant(s)`);
    return abandoned;
  }
}
