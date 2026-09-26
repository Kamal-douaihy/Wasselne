import { Body, Controller, HttpCode, Inject, Post, Req, UseGuards } from "@nestjs/common";
import { Request } from "express";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { AdminAuthService } from "./admin-auth.service";
import { AdminContext, AdminGuard, CurrentAdmin, CurrentMfaAdmin, MfaTokenGuard } from "./admin.guard";
import { codeSchema, loginSchema, recoverySchema } from "./admin.dto";

@Controller("v1/admin/auth")
export class AdminAuthController {
  constructor(@Inject(AdminAuthService) private readonly auth: AdminAuthService) {}

  @Post("login")
  @HttpCode(200)
  login(@Body(new ZodValidationPipe(loginSchema)) dto: { email: string; password: string }, @Req() req: Request) {
    return this.auth.login(dto.email, dto.password, req.ip ?? "unknown");
  }

  @Post("logout")
  @HttpCode(204)
  @UseGuards(AdminGuard)
  async logout(@CurrentAdmin() admin: AdminContext): Promise<void> {
    await this.auth.revokeSession(admin.sessionId);
  }

  @Post("mfa/verify")
  @HttpCode(200)
  @UseGuards(MfaTokenGuard)
  verify(@CurrentMfaAdmin() adminId: string, @Body(new ZodValidationPipe(codeSchema)) dto: { code: string }, @Req() req: Request) {
    return this.auth.verifyMfa(adminId, dto.code, req.ip ?? "unknown");
  }

  @Post("mfa/recovery")
  @HttpCode(200)
  @UseGuards(MfaTokenGuard)
  recovery(@CurrentMfaAdmin() adminId: string, @Body(new ZodValidationPipe(recoverySchema)) dto: { recovery_code: string }, @Req() req: Request) {
    return this.auth.recover(adminId, dto.recovery_code, req.ip ?? "unknown");
  }

  @Post("mfa/enrol")
  @HttpCode(200)
  @UseGuards(MfaTokenGuard)
  enrol(@CurrentMfaAdmin() adminId: string) {
    return this.auth.enrol(adminId);
  }

  @Post("mfa/confirm")
  @HttpCode(204)
  @UseGuards(MfaTokenGuard)
  async confirm(@CurrentMfaAdmin() adminId: string, @Body(new ZodValidationPipe(codeSchema)) dto: { code: string }): Promise<void> {
    await this.auth.confirmEnrolment(adminId, dto.code);
  }
}
