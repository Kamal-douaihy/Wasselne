import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { DocumentExpiryService } from "../modules/drivers/document-expiry.service";
import { UploadCleanupService } from "../modules/uploads/upload-cleanup.service";

const INTERVAL_MS = 15 * 60 * 1000;

// Runs once at start-up and then every 15 minutes: driver-document expiry and abandoned-upload
// cleanup. Both are idempotent, so several workers may run them.
@Injectable()
export class DocumentExpiryJob implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DocumentExpiryJob.name);
  private timer?: NodeJS.Timeout;

  constructor(
    @Inject(DocumentExpiryService) private readonly expiry: DocumentExpiryService,
    @Inject(UploadCleanupService) private readonly uploads: UploadCleanupService,
  ) {}

  onModuleInit(): void {
    void this.tick();
    this.timer = setInterval(() => void this.tick(), INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    try {
      await this.expiry.expireDue();
    } catch (err) {
      this.logger.error(`document expiry sweep failed: ${(err as Error).message}`);
    }
    try {
      await this.uploads.sweepAbandoned();
    } catch (err) {
      this.logger.error(`upload cleanup failed: ${(err as Error).message}`);
    }
  }
}
