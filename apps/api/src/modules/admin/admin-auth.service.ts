import { Inject, Injectable, Logger } from "@nestjs/common";
import jwt from "jsonwebtoken";
import { Kysely, sql } from "kysely";
import { authenticator } from "otplib";
import { ApiError } from "../../common/api-error";
import { RateLimiter } from "../../common/rate-limiter";
import { ENV } from "../../config/env.module";
import { Env } from "../../config/env";
import { DB } from "../../db/db.module";
import { Database } from "../../db/schema-types";
import { REDIS } from "../../redis/redis.module";
import type Redis from "ioredis";
import {
  decryptSecret,
  encryptSecret,
  hashPassword,
  newOpaqueToken,
  newRecoveryCodes,
  normalizeRecoveryCode,
  sha256Hex,
  verifyPassword,
} from "./admin-crypto";

const MFA_AUD = "wasselne:admin-mfa";
const WINDOW_S = 15 * 60;

export interface MfaTokenClaims {
  adm: string;
}

authenticator.options = { window: 1 };

@Injectable()
export class AdminAuthService {
  private readonly logger = new Logger(AdminAuthService.name);
  private dummyHash: Promise<string> | undefined;

  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(ENV) private readonly env: Env,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  signMfaToken(adminId: string): string {
    return jwt.sign({ adm: adminId } satisfies MfaTokenClaims, this.env.JWT_ACCESS_SECRET, { expiresIn: this.env.ADMIN_MFA_TOKEN_TTL_S, audience: MFA_AUD });
  }

  verifyMfaToken(token: string): MfaTokenClaims {
    return jwt.verify(token, this.env.JWT_ACCESS_SECRET, { audience: MFA_AUD }) as MfaTokenClaims;
  }

  // Verifying against a throwaway hash when the email is unknown keeps the response time (and the
  // message) the same, so login cannot be used to discover which emails are admins.
  private getDummyHash(): Promise<string> {
    this.dummyHash ??= hashPassword("not-a-real-password-" + Math.random());
    return this.dummyHash;
  }

  async login(email: string, password: string, ip: string) {
    const e = email.trim().toLowerCase();
    const msg = "Too many sign-in attempts. Try again later.";
    await this.limiter.enforce(this.limiter.key("rl", "admin-login", "ip", ip), this.env.ADMIN_LOGIN_LIMIT_PER_IP_PER_15MIN, WINDOW_S, "RATE_LIMITED", msg);
    await this.limiter.enforce(this.limiter.key("rl", "admin-login", "email", e), this.env.ADMIN_LOGIN_LIMIT_PER_EMAIL_PER_15MIN, WINDOW_S, "RATE_LIMITED", msg);

    const admin = await this.db.selectFrom("admin_users").select(["id", "password_hash", "status", "mfa_enrolled_at"]).where("email", "=", e).executeTakeFirst();
    const ok = await verifyPassword(admin?.password_hash ?? (await this.getDummyHash()), password);
    if (!admin || !ok || admin.status !== "ACTIVE") {
      throw new ApiError(401, "NOT_AUTHENTICATED", "Email or password is incorrect.");
    }
    return { mfa_required: true, mfa_token: this.signMfaToken(admin.id), mfa_enrolled: admin.mfa_enrolled_at !== null };
  }

  private async activeAdmin(adminId: string) {
    const admin = await this.db
      .selectFrom("admin_users")
      .select(["id", "email", "status", "totp_secret_enc", "mfa_enrolled_at"])
      .where("id", "=", adminId)
      .executeTakeFirst();
    if (!admin || admin.status !== "ACTIVE") throw new ApiError(401, "NOT_AUTHENTICATED", "Sign in again.");
    return admin;
  }

  /** Starts (or restarts, before confirmation) enrolment. Never available once enrolled. */
  async enrol(adminId: string) {
    const admin = await this.activeAdmin(adminId);
    if (admin.mfa_enrolled_at) {
      throw new ApiError(409, "INVALID_STATE", "MFA is already set up. A super admin must reset it first.");
    }
    const secret = authenticator.generateSecret();
    const codes = newRecoveryCodes();
    await this.db.transaction().execute(async (trx) => {
      await trx.updateTable("admin_users").set({ totp_secret_enc: encryptSecret(secret, this.env.ADMIN_TOTP_ENC_KEY) }).where("id", "=", adminId).execute();
      await trx.deleteFrom("admin_recovery_codes").where("admin_id", "=", adminId).execute();
      for (const c of codes) {
        await trx.insertInto("admin_recovery_codes").values({ admin_id: adminId, code_hash: sha256Hex(normalizeRecoveryCode(c)), used_at: null }).execute();
      }
    });
    return { qr_uri: authenticator.keyuri(admin.email, this.env.ADMIN_TOTP_ISSUER, secret), secret, recovery_codes: codes };
  }

  private async assertMfaAttemptAllowed(adminId: string): Promise<void> {
    await this.limiter.enforce(
      this.limiter.key("rl", "admin-mfa", adminId),
      this.env.ADMIN_MFA_MAX_ATTEMPTS_PER_15MIN,
      WINDOW_S,
      "RATE_LIMITED",
      "Too many attempts. Try again later.",
    );
  }

  async confirmEnrolment(adminId: string, code: string): Promise<void> {
    await this.assertMfaAttemptAllowed(adminId);
    const admin = await this.activeAdmin(adminId);
    if (admin.mfa_enrolled_at || !admin.totp_secret_enc) throw new ApiError(400, "VALIDATION_FAILED", "Start enrolment first.");
    const secret = decryptSecret(admin.totp_secret_enc, this.env.ADMIN_TOTP_ENC_KEY);
    if (!authenticator.check(code, secret)) throw new ApiError(400, "VALIDATION_FAILED", "That code is not correct.");
    await this.db.updateTable("admin_users").set({ mfa_enrolled_at: sql`now()` as never }).where("id", "=", adminId).where("mfa_enrolled_at", "is", null).execute();
  }

  async verifyMfa(adminId: string, code: string, ip: string) {
    await this.assertMfaAttemptAllowed(adminId);
    const admin = await this.activeAdmin(adminId);
    if (!admin.mfa_enrolled_at || !admin.totp_secret_enc) throw new ApiError(401, "NOT_AUTHENTICATED", "MFA is not set up for this account.");
    const secret = decryptSecret(admin.totp_secret_enc, this.env.ADMIN_TOTP_ENC_KEY);
    if (!authenticator.check(code, secret)) throw new ApiError(401, "NOT_AUTHENTICATED", "That code is not correct.");
    // A code is single-use inside its validity window: replaying a captured code fails.
    const fresh = await this.redis.set(`${this.env.REDIS_KEY_PREFIX}totp-used:${adminId}:${code}`, "1", "EX", 120, "NX").catch(() => null);
    if (fresh !== "OK") throw new ApiError(401, "NOT_AUTHENTICATED", "That code was already used. Wait for the next one.");
    return this.issueSession(adminId, ip);
  }

  async recover(adminId: string, recoveryCode: string, ip: string) {
    await this.assertMfaAttemptAllowed(adminId);
    await this.activeAdmin(adminId);
    const res = await this.db
      .updateTable("admin_recovery_codes")
      .set({ used_at: sql`now()` as never })
      .where("admin_id", "=", adminId)
      .where("code_hash", "=", sha256Hex(normalizeRecoveryCode(recoveryCode)))
      .where("used_at", "is", null)
      .executeTakeFirst();
    if (res.numUpdatedRows === 0n) throw new ApiError(401, "NOT_AUTHENTICATED", "That recovery code is not valid.");
    this.logger.warn(`admin ${adminId} signed in with a recovery code`);
    return this.issueSession(adminId, ip);
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.db.updateTable("admin_sessions").set({ revoked_at: sql`now()` as never }).where("id", "=", sessionId).where("revoked_at", "is", null).execute();
  }

  async loadRoles(adminId: string): Promise<{ roles: string[]; permissions: string[] }> {
    const rows = await this.db
      .selectFrom("admin_user_roles as ur")
      .innerJoin("admin_roles as r", "r.code", "ur.role_code")
      .select(["r.code", "r.permissions"])
      .where("ur.admin_id", "=", adminId)
      .execute();
    return { roles: rows.map((r) => r.code).sort(), permissions: [...new Set(rows.flatMap((r) => r.permissions))].sort() };
  }

  private async issueSession(adminId: string, ip: string) {
    const token = newOpaqueToken();
    const row = await this.db
      .insertInto("admin_sessions")
      .values({
        admin_id: adminId,
        token_hash: sha256Hex(token),
        mfa_verified_at: sql`now()` as never,
        ip,
        revoked_at: null,
        expires_at: sql`now() + make_interval(secs => ${this.env.ADMIN_SESSION_IDLE_TTL_S})` as never,
      })
      .returning("expires_at")
      .executeTakeFirstOrThrow();
    const { roles } = await this.loadRoles(adminId);
    return { access_token: token, expires_at: new Date(row.expires_at as unknown as string).toISOString(), roles };
  }
}
