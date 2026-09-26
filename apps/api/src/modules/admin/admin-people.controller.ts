import { Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { AuditService } from "./audit.service";
import { ApprovalsService, QueueQuery } from "./approvals.service";
import { CurrentAdmin, AdminContext, RequirePermission } from "./admin.guard";
import { PeopleService } from "./people.service";
import {
  auditQuerySchema, blockSchema, categoryEditSchema, documentDecisionSchema, genderConfirmSchema, pageQuerySchema, queueQuerySchema, reasonSchema,
} from "./admin.dto";
import { PageQuery } from "../../common/cursor";

type Reason = { reason: string };
type Block = { applies_to: ("RIDER" | "DRIVER")[]; reason: string };
const uuid = new ParseUUIDPipe();

@Controller("v1/admin")
export class AdminPeopleController {
  constructor(
    @Inject(PeopleService) private readonly people: PeopleService,
    @Inject(ApprovalsService) private readonly approvals: ApprovalsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------- riders
  @Get("riders") @RequirePermission("riders.read")
  riders(@Query(new ZodValidationPipe(pageQuerySchema)) q: PageQuery) { return this.people.listRiders(q); }

  @Get("riders/:id") @RequirePermission("riders.read")
  rider(@Param("id", uuid) id: string) { return this.people.getRider(id); }

  @Post("riders/:id/gender-confirm") @HttpCode(200) @RequirePermission("riders.gender_confirm")
  async riderGender(@CurrentAdmin() a: AdminContext, @Param("id", uuid) id: string, @Body(new ZodValidationPipe(genderConfirmSchema)) b: { confirmed_gender: "FEMALE" | "MALE"; reason: string }): Promise<void> {
    await this.people.confirmGender(a, id, "RIDER", b.confirmed_gender, b.reason);
  }

  @Post("riders/:id/block") @HttpCode(200) @RequirePermission("accounts.block")
  riderBlock(@CurrentAdmin() a: AdminContext, @Param("id", uuid) id: string, @Body(new ZodValidationPipe(blockSchema)) b: Block) {
    return this.people.block(a, id, "RIDER", b.applies_to, b.reason);
  }

  @Post("riders/:id/unblock") @HttpCode(200) @RequirePermission("accounts.block")
  async riderUnblock(@CurrentAdmin() a: AdminContext, @Param("id", uuid) id: string, @Body(new ZodValidationPipe(reasonSchema)) b: Reason): Promise<void> {
    await this.people.unblock(a, id, "RIDER", b.reason);
  }

  // ---------------------------------------------------------------- drivers
  @Get("drivers") @RequirePermission("drivers.read")
  drivers(@Query(new ZodValidationPipe(pageQuerySchema)) q: PageQuery) { return this.people.listDrivers(q); }

  @Get("drivers/:id") @RequirePermission("drivers.read")
  driver(@Param("id", uuid) id: string) { return this.people.getDriver(id); }

  @Patch("drivers/:id/categories") @HttpCode(200) @RequirePermission("drivers.manage")
  async driverCategory(@CurrentAdmin() a: AdminContext, @Param("id", uuid) id: string, @Body(new ZodValidationPipe(categoryEditSchema)) b: { category_id: string; status: "PENDING" | "APPROVED" | "REJECTED" | "PAUSED_BY_DRIVER"; reason: string }): Promise<void> {
    await this.people.editCategory(a, id, b.category_id, b.status, b.reason);
  }

  @Post("drivers/:id/gender-confirm") @HttpCode(200) @RequirePermission("drivers.manage")
  async driverGender(@CurrentAdmin() a: AdminContext, @Param("id", uuid) id: string, @Body(new ZodValidationPipe(genderConfirmSchema)) b: { confirmed_gender: "FEMALE" | "MALE"; reason: string }): Promise<void> {
    await this.people.confirmGender(a, id, "DRIVER", b.confirmed_gender, b.reason);
  }

  @Post("drivers/:id/suspend") @HttpCode(200) @RequirePermission("drivers.manage")
  async suspend(@CurrentAdmin() a: AdminContext, @Param("id", uuid) id: string, @Body(new ZodValidationPipe(reasonSchema)) b: Reason): Promise<void> {
    await this.people.suspend(a, id, b.reason);
  }

  @Post("drivers/:id/reinstate") @HttpCode(200) @RequirePermission("drivers.manage")
  async reinstate(@CurrentAdmin() a: AdminContext, @Param("id", uuid) id: string, @Body(new ZodValidationPipe(reasonSchema)) b: Reason): Promise<void> {
    await this.people.reinstate(a, id, b.reason);
  }

  @Post("drivers/:id/block") @HttpCode(200) @RequirePermission("accounts.block")
  driverBlock(@CurrentAdmin() a: AdminContext, @Param("id", uuid) id: string, @Body(new ZodValidationPipe(blockSchema)) b: Block) {
    return this.people.block(a, id, "DRIVER", b.applies_to, b.reason);
  }

  @Post("drivers/:id/unblock") @HttpCode(200) @RequirePermission("accounts.block")
  async driverUnblock(@CurrentAdmin() a: AdminContext, @Param("id", uuid) id: string, @Body(new ZodValidationPipe(reasonSchema)) b: Reason): Promise<void> {
    await this.people.unblock(a, id, "DRIVER", b.reason);
  }

  // ---------------------------------------------------------------- approvals
  @Get("driver-approvals") @RequirePermission("approvals.read")
  queue(@Query(new ZodValidationPipe(queueQuerySchema)) q: QueueQuery) { return this.approvals.queue(q); }

  @Get("driver-approvals/:id/documents/:documentId/download") @RequirePermission("documents.view")
  download(@CurrentAdmin() a: AdminContext, @Param("id", uuid) id: string, @Param("documentId", uuid) doc: string) {
    return this.approvals.documentDownload(a, id, doc);
  }

  @Post("driver-approvals/:id/documents/:documentId/approve") @HttpCode(200) @RequirePermission("approvals.review")
  docApprove(@CurrentAdmin() a: AdminContext, @Param("id", uuid) id: string, @Param("documentId", uuid) doc: string, @Body(new ZodValidationPipe(documentDecisionSchema)) b: Reason) {
    return this.approvals.decideDocument(a, id, doc, "approve", b.reason);
  }

  @Post("driver-approvals/:id/documents/:documentId/reject") @HttpCode(200) @RequirePermission("approvals.review")
  docReject(@CurrentAdmin() a: AdminContext, @Param("id", uuid) id: string, @Param("documentId", uuid) doc: string, @Body(new ZodValidationPipe(documentDecisionSchema)) b: Reason) {
    return this.approvals.decideDocument(a, id, doc, "reject", b.reason);
  }

  @Post("driver-approvals/:id/documents/:documentId/request-changes") @HttpCode(200) @RequirePermission("approvals.review")
  docRequestChanges(@CurrentAdmin() a: AdminContext, @Param("id", uuid) id: string, @Param("documentId", uuid) doc: string, @Body(new ZodValidationPipe(documentDecisionSchema)) b: Reason) {
    return this.approvals.decideDocument(a, id, doc, "request-changes", b.reason);
  }

  @Post("driver-approvals/:id/approve") @HttpCode(200) @RequirePermission("approvals.review")
  async approve(@CurrentAdmin() a: AdminContext, @Param("id", uuid) id: string, @Body(new ZodValidationPipe(reasonSchema)) b: Reason): Promise<void> {
    await this.approvals.approveDriver(a, id, b.reason);
  }

  @Post("driver-approvals/:id/reject") @HttpCode(200) @RequirePermission("approvals.review")
  async reject(@CurrentAdmin() a: AdminContext, @Param("id", uuid) id: string, @Body(new ZodValidationPipe(reasonSchema)) b: Reason): Promise<void> {
    await this.approvals.rejectDriver(a, id, b.reason);
  }

  // ---------------------------------------------------------------- audit log
  @Get("audit-log") @RequirePermission("audit.read")
  auditLog(@Query(new ZodValidationPipe(auditQuerySchema)) q: { admin_id?: string; target_type?: string; target_id?: string; action?: string; from?: string; to?: string; cursor?: string; limit: number }) {
    return this.audit.list({ adminId: q.admin_id, targetType: q.target_type, targetId: q.target_id, action: q.action, from: q.from, to: q.to, cursor: q.cursor, limit: q.limit });
  }
}
