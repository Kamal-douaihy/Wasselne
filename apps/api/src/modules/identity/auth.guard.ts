import { CanActivate, ExecutionContext, Inject, Injectable, SetMetadata, UseGuards, applyDecorators } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { Request } from "express";
import { Kysely, sql } from "kysely";
import { ApiError } from "../../common/api-error";
import { DB } from "../../db/db.module";
import { Database } from "../../db/schema-types";
import { AccessTokenClaims, AppKind, JwtService, NeedsProfileClaims } from "./jwt.service";

export interface AuthenticatedRequest extends Request {
  auth?: AccessTokenClaims;
  needsProfile?: NeedsProfileClaims;
}

function bearer(req: Request): string {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    throw new ApiError(401, "NOT_AUTHENTICATED", "Missing bearer token.");
  }
  return header.slice("Bearer ".length);
}

const APP_KEY = "wasselne:require-app";

// Explicit @Inject(X): tsx/esbuild's emitDecoratorMetadata was observed to drop the implicit
// design:paramtypes for class-typed constructor params, injecting undefined (README, known notes).
//
// Beyond checking the JWT signature, every request re-reads the session and account from
// PostgreSQL, so revoking a session, deleting an account or applying a block takes effect on the
// next request (01_Architecture §6.1) instead of when the 15-minute access token expires.
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    @Inject(JwtService) private readonly jwtService: JwtService,
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(Reflector) private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    let claims: AccessTokenClaims;
    try {
      claims = this.jwtService.verifyAccessToken(bearer(req));
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError(401, "NOT_AUTHENTICATED", "Invalid or expired token.");
    }

    const row = await this.db
      .selectFrom("sessions as s")
      .innerJoin("accounts as a", "a.id", "s.account_id")
      .select([
        "s.account_id",
        "s.app",
        "a.status as account_status",
        sql<boolean>`s.revoked_at is null and s.expires_at > now()`.as("session_live"),
        sql<boolean>`exists (select 1 from account_blocks b where b.account_id = a.id and b.lifted_at is null
          and b.effective_at is not null and b.effective_at <= now() and s.app = any (b.applies_to))`.as("blocked"),
      ])
      .where("s.id", "=", claims.sid)
      .executeTakeFirst();

    if (!row || row.account_id !== claims.sub || row.app !== claims.app || !row.session_live || row.account_status !== "ACTIVE") {
      throw new ApiError(401, "NOT_AUTHENTICATED", "Session is no longer valid. Sign in again.");
    }
    if (row.blocked) throw new ApiError(403, "ACCOUNT_BLOCKED", "This account is blocked. Contact support.");

    const required = this.reflector.getAllAndOverride<AppKind | undefined>(APP_KEY, [context.getHandler(), context.getClass()]);
    if (required && claims.app !== required) {
      throw new ApiError(403, "NOT_AUTHORIZED", "This action is not available in this app.");
    }
    req.auth = claims;
    return true;
  }
}

/** Authenticated route that only the given app's tokens may call. */
export const RequireApp = (app: AppKind) => applyDecorators(SetMetadata(APP_KEY, app), UseGuards(JwtAuthGuard));

@Injectable()
export class NeedsProfileGuard implements CanActivate {
  constructor(@Inject(JwtService) private readonly jwtService: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    try {
      req.needsProfile = this.jwtService.verifyNeedsProfileToken(bearer(req));
      return true;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError(401, "NOT_AUTHENTICATED", "Invalid or expired token.");
    }
  }
}

/**
 * For routes a person needs both before and after their account exists (the terms shown at
 * sign-up): accepts the short-lived needs-profile token or a normal access token.
 */
@Injectable()
export class AccessOrNeedsProfileGuard implements CanActivate {
  constructor(
    @Inject(JwtService) private readonly jwtService: JwtService,
    @Inject(JwtAuthGuard) private readonly access: JwtAuthGuard,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    try {
      req.needsProfile = this.jwtService.verifyNeedsProfileToken(bearer(req));
      return true;
    } catch {
      return this.access.canActivate(context);
    }
  }
}
