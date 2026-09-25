import type Redis from "ioredis";
import { ApiError } from "../../../common/api-error";

export const SMS_SENDER = Symbol("SMS_SENDER");

export interface SmsSender {
  sendOtp(input: { phoneE164: string; code: string; challengeId: string; ttlSeconds: number }): Promise<void>;
}

// Local-only stand-in for a real SMS provider (none is selected or approved yet). The code is
// stored in Redis so local tools and tests can read it; the API never returns it, and loadEnv
// refuses this adapter in production.
export class DevSmsSender implements SmsSender {
  constructor(
    private readonly redis: Redis,
    private readonly keyPrefix: string,
  ) {}

  static keyFor(prefix: string, challengeId: string): string {
    return `${prefix}dev:sms:${challengeId}`;
  }

  async sendOtp(input: { code: string; challengeId: string; ttlSeconds: number }): Promise<void> {
    await this.redis.set(DevSmsSender.keyFor(this.keyPrefix, input.challengeId), input.code, "EX", input.ttlSeconds);
  }
}

export class DisabledSmsSender implements SmsSender {
  async sendOtp(): Promise<void> {
    throw new ApiError(503, "PROVIDER_TEMPORARY_FAILURE", "SMS delivery is not available right now.");
  }
}
