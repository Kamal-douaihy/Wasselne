import { Body, Controller, HttpCode, HttpStatus, Inject, Post, Req } from "@nestjs/common";
import { Request } from "express";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { RequestOtpDto, VerifyOtpDto, requestOtpSchema, verifyOtpSchema } from "./dto";
import { IdentityService } from "./identity.service";

// Paths are /v1/... to match the contract's server base https://api.wasselne.example/v1.
@Controller("v1/auth/otp")
export class OtpController {
  // Explicit @Inject: see the note in auth.guard.ts.
  constructor(@Inject(IdentityService) private readonly identityService: IdentityService) {}

  @Post("request")
  @HttpCode(HttpStatus.OK)
  requestOtp(@Body(new ZodValidationPipe(requestOtpSchema)) dto: RequestOtpDto, @Req() req: Request) {
    return this.identityService.requestOtp(dto, req.ip ?? "unknown");
  }

  @Post("verify")
  @HttpCode(HttpStatus.OK)
  verifyOtp(@Body(new ZodValidationPipe(verifyOtpSchema)) dto: VerifyOtpDto, @Req() req: Request) {
    return this.identityService.verifyOtp(dto, req.ip ?? "unknown");
  }
}
