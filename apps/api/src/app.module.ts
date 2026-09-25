import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { EnvModule } from "./config/env.module";
import { LoggerModule } from "./common/logger.module";
import { DbModule } from "./db/db.module";
import { RedisModule } from "./redis/redis.module";
import { RateLimitModule } from "./common/rate-limit.module";
import { HttpExceptionFilter } from "./common/http-exception.filter";
import { IpRateLimitGuard } from "./common/ip-rate-limit.guard";
import { HealthModule } from "./modules/health/health.module";
import { IdentityModule } from "./modules/identity/identity.module";

@Module({
  imports: [EnvModule, LoggerModule, DbModule, RedisModule, RateLimitModule, HealthModule, IdentityModule],
  providers: [
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_GUARD, useClass: IpRateLimitGuard },
  ],
})
export class AppModule {}
