import { Body, Controller, HttpCode, Inject, Param, ParseUUIDPipe, Post, UseGuards } from "@nestjs/common";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { JwtAuthGuard } from "../identity/auth.guard";
import { CurrentAccount } from "../identity/current-account.decorator";
import { AccessTokenClaims } from "../identity/jwt.service";
import { UploadAuthorizeDto, UploadsService, uploadAuthorizeSchema } from "./uploads.service";

@Controller("v1/uploads")
@UseGuards(JwtAuthGuard)
export class UploadsController {
  constructor(@Inject(UploadsService) private readonly uploads: UploadsService) {}

  @Post("authorize")
  @HttpCode(201)
  authorize(@CurrentAccount() auth: AccessTokenClaims, @Body(new ZodValidationPipe(uploadAuthorizeSchema)) dto: UploadAuthorizeDto) {
    return this.uploads.authorize(auth, dto);
  }

  @Post(":id/complete")
  @HttpCode(200)
  complete(@CurrentAccount() auth: AccessTokenClaims, @Param("id", ParseUUIDPipe) id: string) {
    return this.uploads.complete(auth, id);
  }
}
