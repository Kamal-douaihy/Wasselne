import { Module } from "@nestjs/common";
import { EnvModule } from "../config/env.module";
import { LoggerModule } from "../common/logger.module";
import { DbModule } from "../db/db.module";
import { RedisModule } from "../redis/redis.module";
import { DocumentExpiryService } from "../modules/drivers/document-expiry.service";
import { StorageModule } from "../modules/storage/storage.module";
import { UploadCleanupService } from "../modules/uploads/upload-cleanup.service";
import { DocumentExpiryJob } from "./document-expiry.job";

// Phase 3 scaffold plus (Phase 4) the driver-document expiry sweep. It boots against the same
// DB/Redis as the api process and shuts down cleanly. The outbox relay, offer sweeper, dispatcher, translation,
// payout marker, vehicle-check scheduler, presence sweeper, and SOS escalation jobs described in
// docs/phase-2/01_Architecture.md §3 are implemented in the phases that own that behaviour
// (mainly Phase 6 dispatch and Phase 9 safety) — not stubbed here to avoid a false "done" signal.
@Module({ imports: [EnvModule, LoggerModule, DbModule, RedisModule, StorageModule],
  providers: [DocumentExpiryService, UploadCleanupService, DocumentExpiryJob], })
export class WorkerModule {}
