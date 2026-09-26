import { Body, Controller, HttpCode, Inject, Post, UseGuards } from "@nestjs/common";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { JwtAuthGuard } from "./auth.guard";
import { CurrentAccount } from "./current-account.decorator";
import { RefreshDto, refreshSchema } from "./dto";
import { IdentityService } from "./identity.service";
import { AccessTokenClaims } from "./jwt.service";

@Controller("v1/auth")
export class SessionController {
  constructor(@Inject(IdentityService) private readonly identityService: IdentityService) {}

  @Post("token/refresh")
  @HttpCode(200)
  refresh(@Body(new ZodValidationPipe(refreshSchema)) dto: RefreshDto) {
    return this.identityService.refresh(dto.refresh_token);
  }

  @Post("logout")
  @HttpCode(204)
  @UseGuards(JwtAuthGuard)
  async logout(
    @CurrentAccount() auth: AccessTokenClaims,
    @Body(new ZodValidationPipe(refreshSchema)) dto: RefreshDto,
  ): Promise<void> {
    await this.identityService.logout(auth.sid, auth.sub, dto.refresh_token);
  }
}
