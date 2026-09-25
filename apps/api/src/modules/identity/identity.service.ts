import { Inject, Injectable, Logger } from "@nestjs/common";
import { Kysely, Transaction, sql } from "kysely";
import { randomUUID } from "node:crypto";
import { ApiError } from "../../common/api-error";
import { RateLimiter } from "../../common/rate-limiter";
import { ENV } from "../../config/env.module";
import { Env } from "../../config/env";
import { DB } from "../../db/db.module";
import { Database } from "../../db/schema-types";
import { CompleteProfileDto, RequestOtpDto, VerifyOtpDto } from "./dto";
import { AppKind, JwtService, NeedsProfileClaims } from "./jwt.service";
import { generateOtpCode, generateRefreshToken, hashOtpCode, hashToken, verifyOtpCode } from "./otp.util";
import { SMS_SENDER, SmsSender } from "./sms/sms-sender";

// Response shapes follow components/schemas in docs/phase-2/openapi.yaml.
export interface OtpRequestResponse {
  challenge_id: string;
  expires_at: string;
  resend_after: string;
}
export interface SessionTokens {
  access_token: string;
  refresh_token: string;
  expires_at: string;
}
export interface OtpVerifyResponse {
  status: "SESSION" | "NEEDS_PROFILE";
  session?: SessionTokens;
  needs_profile_token?: string;
  account_id?: string;
}

type Db = Kysely<Database> | Transaction<Database>;

type VerifyOutcome =
  | { kind: "unknown" }
  | { kind: "expired" }
  | { kind: "locked"; retryAfter: number }
  | { kind: "wrong_code" }
  | { kind: "deleted" }
  | { kind: "blocked" }
  | { kind: "ok"; response: OtpVerifyResponse };

const PG_UNIQUE_VIOLATION = "23505";

@Injectable()
export class IdentityService {
  private readonly logger = new Logger(IdentityService.name);

  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
    @Inject(ENV) private readonly env: Env,
    @Inject(JwtService) private readonly jwtService: JwtService,
    @Inject(SMS_SENDER) private readonly sms: SmsSender,
  ) {}

  async requestOtp(dto: RequestOtpDto, ip: string): Promise<OtpRequestResponse> {
    const msg = "Too many code requests. Try again later.";
    await this.limiter.enforce(
      this.limiter.key("rl", "otp-req", "ip", ip),
      this.env.OTP_REQUEST_LIMIT_PER_IP_PER_HOUR,
      3600,
      "OTP_RATE_LIMITED",
      msg,
    );
    await this.limiter.enforce(
      this.limiter.key("rl", "otp-req", "phone", dto.phone_e164),
      this.env.OTP_REQUEST_LIMIT_PER_PHONE_PER_HOUR,
      3600,
      "OTP_RATE_LIMITED",
      msg,
    );
    const wait = await this.limiter.cooldown(
      this.limiter.key("cd", "otp-resend", dto.phone_e164),
      this.env.OTP_RESEND_INTERVAL_S,
    );
    if (wait > 0) {
      throw new ApiError(429, "OTP_RATE_LIMITED", "A code was just sent. Wait before requesting another.", undefined, wait);
    }

    const code = generateOtpCode();
    const row = await this.db
      .insertInto("otp_challenges")
      .values({
        phone_e164: dto.phone_e164,
        app: dto.app,
        code_hash: hashOtpCode(code),
        // Expiry from the database clock, like every other deadline in this system.
        expires_at: sql`now() + make_interval(secs => ${this.env.OTP_TTL_S})` as never,
      })
      .returning(["id", "expires_at", "created_at"])
      .executeTakeFirstOrThrow();

    try {
      await this.sms.sendOtp({
        phoneE164: dto.phone_e164,
        code,
        challengeId: row.id,
        ttlSeconds: this.env.OTP_TTL_S,
      });
    } catch (err) {
      // A code nobody received must not stay redeemable.
      await this.db.updateTable("otp_challenges").set({ consumed_at: sql`now()` as never }).where("id", "=", row.id).execute();
      if (err instanceof ApiError) throw err;
      throw new ApiError(503, "PROVIDER_TEMPORARY_FAILURE", "SMS delivery is not available right now.");
    }

    this.logger.log(`otp challenge created challengeId=${row.id} app=${dto.app}`);
    const createdAt = new Date(row.created_at as unknown as string);
    return {
      challenge_id: row.id,
      expires_at: new Date(row.expires_at as unknown as string).toISOString(),
      resend_after: new Date(createdAt.getTime() + this.env.OTP_RESEND_INTERVAL_S * 1000).toISOString(),
    };
  }

  /**
   * One transaction: lock the challenge row, check it, verify the code, then consume it and
   * create the session (or mint the needs-profile token). Concurrent verifies of one challenge
   * queue on the row lock, so at most one can consume it, and a failure after consumption
   * (including token signing) rolls the consumption back.
   */
  async verifyOtp(dto: VerifyOtpDto, ip: string): Promise<OtpVerifyResponse> {
    await this.limiter.enforce(
      this.limiter.key("rl", "otp-verify", "ip", ip),
      this.env.OTP_VERIFY_LIMIT_PER_IP_PER_HOUR,
      3600,
      "OTP_RATE_LIMITED",
      "Too many verification attempts. Try again later.",
    );

    const outcome = await this.db.transaction().execute(async (trx): Promise<VerifyOutcome> => {
      const challenge = await trx
        .selectFrom("otp_challenges")
        .select([
          "id",
          "phone_e164",
          "app",
          "code_hash",
          "attempts",
          "consumed_at",
          sql<boolean>`expires_at <= now()`.as("is_expired"),
          sql<number>`greatest(1, ceil(extract(epoch from (expires_at - now()))))`.as("seconds_left"),
        ])
        .where("id", "=", dto.challenge_id)
        .forUpdate()
        .executeTakeFirst();

      if (!challenge) return { kind: "unknown" };
      if (challenge.consumed_at || challenge.is_expired) return { kind: "expired" };
      if (challenge.attempts >= this.env.OTP_MAX_ATTEMPTS) {
        return { kind: "locked", retryAfter: Number(challenge.seconds_left) };
      }
      if (!verifyOtpCode(dto.code, challenge.code_hash)) {
        await trx
          .updateTable("otp_challenges")
          .set((eb) => ({ attempts: eb("attempts", "+", 1) }))
          .where("id", "=", challenge.id)
          .execute();
        return { kind: "wrong_code" };
      }

      const account = await trx
        .selectFrom("accounts")
        .select(["id", "status"])
        .where("phone_e164", "=", challenge.phone_e164)
        .executeTakeFirst();

      if (account) {
        if (account.status !== "ACTIVE") return { kind: "deleted" };
        const block = await trx
          .selectFrom("account_blocks")
          .select("id")
          .where("account_id", "=", account.id)
          .where("lifted_at", "is", null)
          .where("effective_at", "<=", sql`now()` as never)
          .where(sql<boolean>`${challenge.app}::app_kind = any(applies_to)`)
          .executeTakeFirst();
        if (block) return { kind: "blocked" };
      }

      await trx.updateTable("otp_challenges").set({ consumed_at: sql`now()` as never }).where("id", "=", challenge.id).execute();

      if (account) {
        const session = await this.createSession(trx, account.id, challenge.app);
        return { kind: "ok", response: { status: "SESSION", session, account_id: account.id } };
      }
      const claims: NeedsProfileClaims = { phone: challenge.phone_e164, app: challenge.app, cid: challenge.id };
      return { kind: "ok", response: { status: "NEEDS_PROFILE", needs_profile_token: this.jwtService.signNeedsProfileToken(claims) } };
    });

    switch (outcome.kind) {
      case "ok":
        return outcome.response;
      case "expired":
        throw new ApiError(410, "OTP_EXPIRED", "This code has expired or was already used. Request a new one.");
      case "locked":
        throw new ApiError(429, "OTP_RATE_LIMITED", "Too many incorrect attempts. Request a new code.", undefined, outcome.retryAfter);
      case "deleted":
        throw new ApiError(403, "NOT_AUTHORIZED", "This account cannot sign in.");
      case "blocked":
        throw new ApiError(403, "ACCOUNT_BLOCKED", "This account is blocked. Contact support.");
      default:
        throw new ApiError(400, "OTP_INVALID", "The code is not correct.");
    }
  }

  async completeProfile(claims: NeedsProfileClaims, dto: CompleteProfileDto): Promise<SessionTokens> {
    try {
      return await this.db.transaction().execute(async (trx) => {
        if (dto.accepted_legal_version_ids.length > 0) {
          const found = await trx
            .selectFrom("legal_document_versions")
            .select("id")
            .where("id", "in", dto.accepted_legal_version_ids)
            .where("status", "=", "PUBLISHED")
            .where(sql<boolean>`${claims.app}::app_kind = any(audience)`)
            .execute();
          if (found.length !== new Set(dto.accepted_legal_version_ids).size) {
            throw new ApiError(400, "VALIDATION_FAILED", "Unknown or unpublished legal document version.");
          }
        }

        const account = await trx
          .insertInto("accounts")
          .values({
            phone_e164: claims.phone,
            first_name: dto.first_name,
            last_name: dto.last_name,
            gender: dto.gender,
            email: dto.email ?? null,
            language: dto.language ?? "ar",
            gender_confirmed_at: null,
            gender_confirmed_by: null,
            preferred_currency: null,
          })
          .returning("id")
          .executeTakeFirstOrThrow();

        if (claims.app === "RIDER") {
          await trx.insertInto("rider_profiles").values({ account_id: account.id, rating_avg_bp: null }).execute();
        }
        for (const versionId of new Set(dto.accepted_legal_version_ids)) {
          await trx
            .insertInto("legal_acceptances")
            .values({ account_id: account.id, version_id: versionId, app: claims.app })
            .execute();
        }
        return this.createSession(trx, account.id, claims.app);
      });
    } catch (err) {
      if ((err as { code?: string }).code === PG_UNIQUE_VIOLATION) {
        // The account exists already: this needs-profile token was used (or a parallel call won).
        throw new ApiError(401, "NOT_AUTHENTICATED", "Profile already completed. Sign in again.");
      }
      throw err;
    }
  }

  async getProfile(accountId: string) {
    const a = await this.db
      .selectFrom("accounts")
      .select(["id", "phone_e164", "first_name", "last_name", "gender", "gender_confirmed_at", "email", "language", "preferred_currency", "status"])
      .where("id", "=", accountId)
      .executeTakeFirst();
    if (!a) throw new ApiError(401, "NOT_AUTHENTICATED", "Account no longer exists.");
    return {
      id: a.id,
      phone_e164: a.phone_e164,
      first_name: a.first_name,
      last_name: a.last_name,
      ...(a.gender ? { gender: a.gender } : {}),
      gender_confirmed: a.gender_confirmed_at !== null,
      email: a.email,
      language: a.language,
      ...(a.preferred_currency ? { preferred_currency: a.preferred_currency } : {}),
      status: a.status,
    };
  }

  // Runs inside the caller's transaction: the session row, the refresh token and the signed
  // access token are all produced before commit, so signing failure rolls everything back.
  private async createSession(db: Db, accountId: string, app: AppKind): Promise<SessionTokens> {
    const sid = randomUUID();
    const access = this.jwtService.signAccessToken({ sub: accountId, app, sid });
    const refresh = generateRefreshToken();
    await db
      .insertInto("sessions")
      .values({
        id: sid,
        account_id: accountId,
        app,
        refresh_token_hash: hashToken(refresh),
        device_label: null,
        last_used_at: null,
        revoked_at: null,
        revoke_reason: null,
        expires_at: new Date(Date.now() + this.env.JWT_REFRESH_TTL_S * 1000),
      })
      .execute();
    return { access_token: access.token, refresh_token: refresh, expires_at: access.expiresAt.toISOString() };
  }
}
