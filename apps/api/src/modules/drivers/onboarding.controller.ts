import { Body, Controller, Get, HttpCode, Inject, Post } from "@nestjs/common";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { RequireApp } from "../identity/auth.guard";
import { CurrentAccount } from "../identity/current-account.decorator";
import { AccessTokenClaims } from "../identity/jwt.service";
import {
  CategoriesDto,
  DocumentAttachDto,
  OnboardingProfileDto,
  VehicleDto,
  categoriesSchema,
  documentAttachSchema,
  onboardingProfileSchema,
  vehicleSchema,
} from "./onboarding.dto";
import { OnboardingService } from "./onboarding.service";

@Controller("v1/driver")
@RequireApp("DRIVER")
export class OnboardingController {
  constructor(@Inject(OnboardingService) private readonly onboarding: OnboardingService) {}

  @Post("onboarding/profile")
  @HttpCode(200)
  profile(@CurrentAccount() a: AccessTokenClaims, @Body(new ZodValidationPipe(onboardingProfileSchema)) dto: OnboardingProfileDto) {
    return this.onboarding.saveProfile(a.sub, dto);
  }

  @Post("onboarding/vehicle")
  @HttpCode(200)
  vehicle(@CurrentAccount() a: AccessTokenClaims, @Body(new ZodValidationPipe(vehicleSchema)) dto: VehicleDto) {
    return this.onboarding.saveVehicle(a.sub, dto);
  }

  @Post("onboarding/categories")
  @HttpCode(200)
  categories(@CurrentAccount() a: AccessTokenClaims, @Body(new ZodValidationPipe(categoriesSchema)) dto: CategoriesDto) {
    return this.onboarding.selectCategories(a.sub, dto);
  }

  @Post("onboarding/documents")
  @HttpCode(201)
  document(@CurrentAccount() a: AccessTokenClaims, @Body(new ZodValidationPipe(documentAttachSchema)) dto: DocumentAttachDto) {
    return this.onboarding.attachDocument(a.sub, dto);
  }

  @Post("onboarding/submit")
  @HttpCode(200)
  submit(@CurrentAccount() a: AccessTokenClaims) {
    return this.onboarding.submit(a.sub);
  }

  @Get("onboarding/options")
  options() {
    return this.onboarding.options();
  }

  @Get("onboarding/status")
  status(@CurrentAccount() a: AccessTokenClaims) {
    return this.onboarding.status(a.sub);
  }

  @Get("documents")
  async documents(@CurrentAccount() a: AccessTokenClaims) {
    return (await this.onboarding.status(a.sub)).documents;
  }
}
