import { Module } from "@nestjs/common";
import { IdentityModule } from "../identity/identity.module";
import { UploadsController } from "./uploads.controller";
import { UploadCleanupService } from "./upload-cleanup.service";
import { UploadsService } from "./uploads.service";

@Module({ imports: [IdentityModule], controllers: [UploadsController], providers: [UploadsService, UploadCleanupService], exports: [UploadsService, UploadCleanupService] })
export class UploadsModule {}
