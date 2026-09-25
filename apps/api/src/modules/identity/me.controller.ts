import { Body, Controller, Get, HttpCode, Inject, Post, UseGuards } from "@nestjs/common";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { JwtAuthGuard, NeedsProfileGuard } from "./auth.guard";
import { CurrentAccount, CurrentNeedsProfile } from "./current-account.decorator";
import { CompleteProfileDto, completeProfileSchema } from "./dto";
import { IdentityService } from "./identity.service";
import { AccessTokenClaims, NeedsProfileClaims } from "./jwt.service";

@Controller("v1/me")
export class MeController {
  constructor(@Inject(IdentityService) private readonly identityService: IdentityService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  getMe(@CurrentAccount() auth: AccessTokenClaims) {
    return this.identityService.getProfile(auth.sub);
  }

  @Post("complete-profile")
  @HttpCode(201)
  @UseGuards(NeedsProfileGuard)
  completeProfile(
    @CurrentNeedsProfile() claims: NeedsProfileClaims,
    @Body(new ZodValidationPipe(completeProfileSchema)) dto: CompleteProfileDto,
  ) {
    return this.identityService.completeProfile(claims, dto);
  }
}
