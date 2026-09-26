import { Module } from "@nestjs/common";
import { IdentityModule } from "../identity/identity.module";
import { DocumentExpiryService } from "./document-expiry.service";
import { EligibilityService } from "./eligibility.service";
import { OnboardingController } from "./onboarding.controller";
import { OnboardingService } from "./onboarding.service";

@Module({
  imports: [IdentityModule],
  controllers: [OnboardingController],
  providers: [OnboardingService, EligibilityService, DocumentExpiryService],
  exports: [OnboardingService, EligibilityService, DocumentExpiryService],
})
export class DriversModule {}
