import { Module } from "@nestjs/common";
import { ENV } from "../../config/env.module";
import { Env } from "../../config/env";
import { REDIS } from "../../redis/redis.module";
import type Redis from "ioredis";
import { JwtAuthGuard, NeedsProfileGuard } from "./auth.guard";
import { IdentityService } from "./identity.service";
import { JwtService } from "./jwt.service";
import { MeController } from "./me.controller";
import { OtpController } from "./otp.controller";
import { DevSmsSender, DisabledSmsSender, SMS_SENDER } from "./sms/sms-sender";

@Module({
  controllers: [OtpController, MeController],
  providers: [
    IdentityService,
    JwtService,
    JwtAuthGuard,
    NeedsProfileGuard,
    {
      provide: SMS_SENDER,
      useFactory: (env: Env, redis: Redis) =>
        env.SMS_ADAPTER === "dev" ? new DevSmsSender(redis, env.REDIS_KEY_PREFIX) : new DisabledSmsSender(),
      inject: [ENV, REDIS],
    },
  ],
})
export class IdentityModule {}
