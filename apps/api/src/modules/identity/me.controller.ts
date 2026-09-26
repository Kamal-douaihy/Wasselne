import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { Kysely } from "kysely";
import { ApiError } from "../../common/api-error";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { DB } from "../../db/db.module";
import { Database } from "../../db/schema-types";
import { AccessOrNeedsProfileGuard, AuthenticatedRequest, JwtAuthGuard, NeedsProfileGuard } from "./auth.guard";
import { CurrentAccount, CurrentNeedsProfile } from "./current-account.decorator";
import {
  CompleteProfileDto,
  ProfileUpdateDto,
  PushDeviceDto,
  completeProfileSchema,
  profileUpdateSchema,
  pushDeviceSchema,
} from "./dto";
import { IdentityService } from "./identity.service";
import { AccessTokenClaims, NeedsProfileClaims } from "./jwt.service";
import { LegalService } from "./legal.service";
import { z } from "zod";

const languageQuerySchema = z.enum(["ar", "en", "fr"]).optional();

@Controller("v1")
export class MeController {
  constructor(
    @Inject(IdentityService) private readonly identityService: IdentityService,
    @Inject(LegalService) private readonly legal: LegalService,
    @Inject(DB) private readonly db: Kysely<Database>,
  ) {}

  @Get("me")
  @UseGuards(JwtAuthGuard)
  getMe(@CurrentAccount() auth: AccessTokenClaims) {
    return this.identityService.getProfile(auth.sub);
  }

  @Patch("me")
  @UseGuards(JwtAuthGuard)
  updateMe(@CurrentAccount() auth: AccessTokenClaims, @Body(new ZodValidationPipe(profileUpdateSchema)) dto: ProfileUpdateDto) {
    return this.identityService.updateProfile(auth.sub, dto);
  }

  @Post("me/complete-profile")
  @HttpCode(201)
  @UseGuards(NeedsProfileGuard)
  completeProfile(
    @CurrentNeedsProfile() claims: NeedsProfileClaims,
    @Body(new ZodValidationPipe(completeProfileSchema)) dto: CompleteProfileDto,
  ) {
    return this.identityService.completeProfile(claims, dto);
  }

  @Get("legal/current")
  @UseGuards(AccessOrNeedsProfileGuard)
  legalCurrent(@Req() req: AuthenticatedRequest, @Query("language", new ZodValidationPipe(languageQuerySchema)) language?: "ar" | "en" | "fr") {
    if (req.auth) return this.legal.listCurrent(req.auth.sub, req.auth.app);
    return this.legal.listCurrent(null, req.needsProfile!.app, language);
  }

  @Post("legal/:versionId/accept")
  @HttpCode(204)
  @UseGuards(JwtAuthGuard)
  async legalAccept(@CurrentAccount() auth: AccessTokenClaims, @Param("versionId", ParseUUIDPipe) versionId: string): Promise<void> {
    await this.legal.accept(auth.sub, auth.app, versionId);
  }

  @Post("push/devices")
  @HttpCode(201)
  @UseGuards(JwtAuthGuard)
  async pushRegister(@CurrentAccount() auth: AccessTokenClaims, @Body(new ZodValidationPipe(pushDeviceSchema)) dto: PushDeviceDto): Promise<void> {
    // A device token belongs to whoever registered it last (shared phones, re-installs).
    await this.db
      .insertInto("push_devices")
      .values({ account_id: auth.sub, app: auth.app, platform: dto.platform, token: dto.token })
      .onConflict((oc) => oc.column("token").doUpdateSet({ account_id: auth.sub, app: auth.app, platform: dto.platform }))
      .execute();
  }

  @Delete("push/devices/:id")
  @HttpCode(204)
  @UseGuards(JwtAuthGuard)
  async pushUnregister(@CurrentAccount() auth: AccessTokenClaims, @Param("id", ParseUUIDPipe) id: string): Promise<void> {
    const res = await this.db.deleteFrom("push_devices").where("id", "=", id).where("account_id", "=", auth.sub).executeTakeFirst();
    if (res.numDeletedRows === 0n) throw new ApiError(404, "NOT_FOUND", "Unknown device.");
  }
}
