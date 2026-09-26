import { Inject, Injectable, Logger } from "@nestjs/common";
import { Kysely, Transaction, sql } from "kysely";
import { randomUUID } from "node:crypto";
import { ApiError } from "../../common/api-error";
import { RateLimiter } from "../../common/rate-limiter";
import { ENV } from "../../config/env.module";
import { Env } from "../../config/env";
import { DB } from "../../db/db.module";
import { Database } from "../../db/schema-types";
import { CompleteProfileDto, ProfileUpdateDto, RequestOtpDto, VerifyOtpDto } from "./dto";
import { LegalService } from "./legal.service";
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
    @Inject(LegalService) private readonly legal: LegalService,
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
        if (challenge.app === "RIDER") {
          // A driver-only account signing in to the rider app gets its rider profile on first use.
          await trx
            .insertInto("rider_profiles")
            .values({ account_id: account.id, rating_avg_bp: null })
            .onConflict((oc) => oc.column("account_id").doNothing())
            .execute();
        }
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
        await this.legal.assertAcceptedSetComplete(trx, claims.app, dto.accepted_legal_version_ids);

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
        } else {
          await trx
            .insertInto("driver_profiles")
            .values({ account_id: account.id, status: "ONBOARDING", status_reason: null, submitted_at: null, decided_at: null, decided_by: null, current_vehicle_id: null, rating_avg_bp: null })
            .execute();
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

  /**
   * Rotates the refresh token. The hash of the token just replaced is kept in
   * previous_refresh_token_hash; presenting it again means the token leaked or was replayed, so
   * the whole session is revoked (01_Architecture §6.1). A client that retries after a lost
   * response therefore has to sign in again: that is the intended strictness.
   */
  async refresh(refreshToken: string): Promise<SessionTokens> {
    const hash = hashToken(refreshToken);
    type Outcome = { kind: "ok"; tokens: SessionTokens } | { kind: "invalid" };
    const outcome = await this.db.transaction().execute(async (trx): Promise<Outcome> => {
      const session = await trx
        .selectFrom("sessions")
        .select(["id", "account_id", "app", sql<boolean>`revoked_at is null and expires_at > now()`.as("live")])
        .where("refresh_token_hash", "=", hash)
        .forUpdate()
        .executeTakeFirst();
      if (!session) {
        const reused = await trx
          .updateTable("sessions")
          .set({ revoked_at: sql`now()` as never, revoke_reason: "REFRESH_REUSE" })
          .where("previous_refresh_token_hash", "=", hash)
          .where("revoked_at", "is", null)
          .executeTakeFirst();
        if (reused.numUpdatedRows > 0n) this.logger.warn("refresh token reuse detected; session revoked");
        return { kind: "invalid" };
      }
      if (!session.live) return { kind: "invalid" };

      const account = await trx.selectFrom("accounts").select("status").where("id", "=", session.account_id).executeTakeFirst();
      const blocked = await trx
        .selectFrom("account_blocks")
        .select("id")
        .where("account_id", "=", session.account_id)
        .where("lifted_at", "is", null)
        .where("effective_at", "<=", sql`now()` as never)
        .where(sql<boolean>`${session.app}::app_kind = any(applies_to)`)
        .executeTakeFirst();
      if (account?.status !== "ACTIVE" || blocked) {
        await trx.updateTable("sessions").set({ revoked_at: sql`now()` as never, revoke_reason: "ACCOUNT_INACTIVE" }).where("id", "=", session.id).execute();
        return { kind: "invalid" };
      }

      const next = generateRefreshToken();
      const access = this.jwtService.signAccessToken({ sub: session.account_id, app: session.app, sid: session.id });
      await trx
        .updateTable("sessions")
        .set({ refresh_token_hash: hashToken(next), previous_refresh_token_hash: hash, last_used_at: sql`now()` as never })
        .where("id", "=", session.id)
        .execute();
      return { kind: "ok", tokens: { access_token: access.token, refresh_token: next, expires_at: access.expiresAt.toISOString() } };
    });
    if (outcome.kind !== "ok") throw new ApiError(401, "NOT_AUTHENTICATED", "Refresh token is not valid. Sign in again.");
    return outcome.tokens;
  }

  /** Revokes the caller's own session; the refresh token must belong to that session. */
  async logout(sessionId: string, accountId: string, refreshToken: string): Promise<void> {
    const hash = hashToken(refreshToken);
    const res = await this.db
      .updateTable("sessions")
      .set({ revoked_at: sql`now()` as never, revoke_reason: "LOGOUT" })
      .where("id", "=", sessionId)
      .where("account_id", "=", accountId)
      .where("revoked_at", "is", null)
      .where((eb) => eb.or([eb("refresh_token_hash", "=", hash), eb("previous_refresh_token_hash", "=", hash)]))
      .executeTakeFirst();
    if (res.numUpdatedRows === 0n) throw new ApiError(401, "NOT_AUTHENTICATED", "Refresh token does not belong to this session.");
  }

  async updateProfile(accountId: string, dto: ProfileUpdateDto) {
    if (dto.preferred_currency) {
      const cur = await this.db.selectFrom("currencies").select("code").where("code", "=", dto.preferred_currency).executeTakeFirst();
      if (!cur) throw new ApiError(400, "VALIDATION_FAILED", "Unknown currency.", { issues: [{ path: "preferred_currency", message: "unknown currency" }] });
    }
    const patch: Record<string, unknown> = {};
    for (const k of ["first_name", "last_name", "email", "language", "preferred_currency"] as const) {
      if (dto[k] !== undefined) patch[k] = dto[k];
    }
    if (Object.keys(patch).length > 0) {
      await this.db.updateTable("accounts").set(patch as never).where("id", "=", accountId).execute();
    }
    return this.getProfile(accountId);
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
