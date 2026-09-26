import { Module } from "@nestjs/common";
import { DriversModule } from "../drivers/drivers.module";
import { AdminAuthController } from "./admin-auth.controller";
import { AdminAuthService } from "./admin-auth.service";
import { AdminPeopleController } from "./admin-people.controller";
import { AdminGuard, MfaTokenGuard } from "./admin.guard";
import { ApprovalsService } from "./approvals.service";
import { AuditService } from "./audit.service";
import { PeopleService } from "./people.service";

@Module({
  imports: [DriversModule],
  controllers: [AdminAuthController, AdminPeopleController],
  providers: [AdminAuthService, AdminGuard, MfaTokenGuard, AuditService, PeopleService, ApprovalsService],
  exports: [AdminAuthService, AuditService, PeopleService],
})
export class AdminModule {}
