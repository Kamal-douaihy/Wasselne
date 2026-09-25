import { Inject, Injectable } from "@nestjs/common";
import type Redis from "ioredis";
import { REDIS } from "../redis/redis.module";
import { ENV } from "../config/env.module";
import { Env } from "../config/env";
import { ApiError } from "./api-error";

// INCR + EXPIRE in one Lua script so a crash can never leave a counter without a TTL.
const HIT_SCRIPT = `
local c = redis.call('INCR', KEYS[1])
local ttl = redis.call('TTL', KEYS[1])
if c == 1 or ttl < 0 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {c, ttl}
`;

export interface RateLimitOutcome {
  allowed: boolean;
  retryAfterSeconds: number;
}

@Injectable()
export class RateLimiter {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) private readonly env: Env,
  ) {}

  key(...parts: string[]): string {
    return this.env.REDIS_KEY_PREFIX + parts.join(":");
  }

  async hit(key: string, limit: number, windowSeconds: number): Promise<RateLimitOutcome> {
    try {
      const [count, ttl] = (await this.redis.eval(HIT_SCRIPT, 1, key, windowSeconds)) as [number, number];
      return { allowed: count <= limit, retryAfterSeconds: Math.max(1, ttl) };
    } catch {
      // Fail closed: without Redis we cannot enforce abuse limits, so refuse rather than allow.
      throw new ApiError(503, "PROVIDER_TEMPORARY_FAILURE", "Temporarily unavailable. Try again shortly.");
    }
  }

  /** Returns 0 when the cooldown was free (and starts it), else the seconds still to wait. */
  async cooldown(key: string, seconds: number): Promise<number> {
    if (seconds <= 0) return 0;
    try {
      const set = await this.redis.set(key, "1", "EX", seconds, "NX");
      if (set === "OK") return 0;
      return Math.max(1, await this.redis.ttl(key));
    } catch {
      throw new ApiError(503, "PROVIDER_TEMPORARY_FAILURE", "Temporarily unavailable. Try again shortly.");
    }
  }

  /** Throws the contract's 429 (code + Retry-After) when the limit is exceeded. */
  async enforce(
    key: string,
    limit: number,
    windowSeconds: number,
    code: "OTP_RATE_LIMITED" | "RATE_LIMITED",
    message: string,
  ): Promise<void> {
    const outcome = await this.hit(key, limit, windowSeconds);
    if (!outcome.allowed) {
      throw new ApiError(429, code, message, undefined, outcome.retryAfterSeconds);
    }
  }
}
