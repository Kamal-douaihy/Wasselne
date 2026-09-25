import { CanActivate, ExecutionContext, Inject, Injectable } from "@nestjs/common";
import { Request } from "express";
import { ApiError } from "../../common/api-error";
import { AccessTokenClaims, JwtService, NeedsProfileClaims } from "./jwt.service";

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

// Explicit @Inject(X): tsx/esbuild's emitDecoratorMetadata was observed to drop the implicit
// design:paramtypes for class-typed constructor params, injecting undefined (README, known notes).
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(@Inject(JwtService) private readonly jwtService: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    try {
      req.auth = this.jwtService.verifyAccessToken(bearer(req));
      return true;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError(401, "NOT_AUTHENTICATED", "Invalid or expired token.");
    }
  }
}

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
