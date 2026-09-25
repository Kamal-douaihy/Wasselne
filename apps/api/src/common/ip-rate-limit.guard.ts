import { CanActivate, ExecutionContext, Inject, Injectable } from "@nestjs/common";
import { Request } from "express";
import { ENV } from "../config/env.module";
import { Env } from "../config/env";
import { RateLimiter } from "./rate-limiter";

// Coarse per-IP ceiling on every route (except /health) as a backstop behind the tighter
// per-endpoint OTP limits. Rejects with the contract's RATE_LIMITED + Retry-After.
@Injectable()
export class IpRateLimitGuard implements CanActivate {
  constructor(
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    if (req.path === "/health") return true;
    const minute = Math.floor(Date.now() / 60_000);
    await this.limiter.enforce(
      this.limiter.key("rl", "ip", req.ip ?? "unknown", String(minute)),
      this.env.GLOBAL_LIMIT_PER_IP_PER_MINUTE,
      60,
      "RATE_LIMITED",
      "Too many requests. Try again shortly.",
    );
    return true;
  }
}
