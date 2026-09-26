import { CanActivate, ExecutionContext, Inject, Injectable, Logger, SetMetadata, UseGuards, applyDecorators, createParamDecorator } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Request } from "express";
import { Kysely, sql } from "kysely";
import { ApiError } from "../../common/api-error";
import { ENV } from "../../config/env.module";
import { Env } from "../../config/env";
import { DB } from "../../db/db.module";
import { Database } from "../../db/schema-types";
import { AdminAuthService } from "./admin-auth.service";
import { sha256Hex } from "./admin-crypto";

export interface AdminContext {
  id: string;
  sessionId: string;
  roles: string[];
  permissions: string[];
  ip: string;
  correlationId: string;
}

type AdminRequest = Request & { admin?: AdminContext; mfaAdminId?: string };

const PERMISSION_KEY = "wasselne:admin-permission";

// Admin sessions are opaque random tokens, stored hashed. A session only exists after password
// AND TOTP (or recovery code), so a bearer that is merely an mfa_token is refused here.
@Injectable()
export class AdminGuard implements CanActivate {
  private readonly logger = new Logger(AdminGuard.name);
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(ENV) private readonly env: Env,
    @Inject(AdminAuthService) private readonly auth: AdminAuthService,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AdminRequest>();
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) throw new ApiError(401, "NOT_AUTHENTICATED", "Missing bearer token.");
    const hash = sha256Hex(header.slice(7));

    const s = await this.db
      .selectFrom("admin_sessions as s")
      .innerJoin("admin_users as u", "u.id", "s.admin_id")
      .select(["s.id", "s.admin_id", "u.status", sql<number>`extract(epoch from (s.expires_at - now()))`.as("secs_left")])
      .where("s.token_hash", "=", hash)
      .where("s.revoked_at", "is", null)
      .where("s.mfa_verified_at", "is not", null)
      .where("s.expires_at", ">", sql`now()` as never)
      .executeTakeFirst();
    if (!s || s.status !== "ACTIVE") throw new ApiError(401, "NOT_AUTHENTICATED", "Session is no longer valid. Sign in again.");

    // Sliding idle window, written at most about once a minute per session.
    if (Number(s.secs_left) < this.env.ADMIN_SESSION_IDLE_TTL_S - 60) {
      await this.db
        .updateTable("admin_sessions")
        .set({ expires_at: sql`now() + make_interval(secs => ${this.env.ADMIN_SESSION_IDLE_TTL_S})` as never })
        .where("id", "=", s.id)
        .execute();
    }

    const { roles, permissions } = await this.auth.loadRoles(s.admin_id);
    req.admin = { id: s.admin_id, sessionId: s.id, roles, permissions, ip: req.ip ?? "unknown", correlationId: String(req.id ?? "") };

    const needed = this.reflector.getAllAndOverride<string | undefined>(PERMISSION_KEY, [context.getHandler(), context.getClass()]);
    if (needed && !permissions.includes(needed)) {
      // Logged as an access attempt (03_Admin_Console §3); the response leaks no data.
      this.logger.warn(`permission denied admin=${s.admin_id} needs=${needed} route=${req.method} ${req.path}`);
      throw new ApiError(403, "NOT_AUTHORIZED", "You do not have permission to do this.");
    }
    return true;
  }
}

/** Admin-only route; `permission` is the string from admin_roles.permissions the caller must hold. */
export const RequirePermission = (permission: string) => applyDecorators(SetMetadata(PERMISSION_KEY, permission), UseGuards(AdminGuard));

export const CurrentAdmin = createParamDecorator((_: unknown, ctx: ExecutionContext): AdminContext => {
  const req = ctx.switchToHttp().getRequest<AdminRequest>();
  if (!req.admin) throw new Error("CurrentAdmin used outside an AdminGuard route.");
  return req.admin;
});

/** Guards the MFA enrolment/verification routes: bearer must be the short-lived mfa_token. */
@Injectable()
export class MfaTokenGuard implements CanActivate {
  constructor(@Inject(AdminAuthService) private readonly auth: AdminAuthService) {}
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AdminRequest>();
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) throw new ApiError(401, "NOT_AUTHENTICATED", "Missing bearer token.");
    try {
      req.mfaAdminId = this.auth.verifyMfaToken(header.slice(7)).adm;
      return true;
    } catch {
      throw new ApiError(401, "NOT_AUTHENTICATED", "Sign in again.");
    }
  }
}

export const CurrentMfaAdmin = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const req = ctx.switchToHttp().getRequest<AdminRequest>();
  if (!req.mfaAdminId) throw new Error("CurrentMfaAdmin used outside an MfaTokenGuard route.");
  return req.mfaAdminId;
});
