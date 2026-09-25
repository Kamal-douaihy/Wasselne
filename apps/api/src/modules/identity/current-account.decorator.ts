import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import { AccessTokenClaims, NeedsProfileClaims } from "./jwt.service";
import { AuthenticatedRequest } from "./auth.guard";

export const CurrentAccount = createParamDecorator((_: unknown, ctx: ExecutionContext): AccessTokenClaims => {
  const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
  if (!req.auth) throw new Error("CurrentAccount used outside a JwtAuthGuard-protected route.");
  return req.auth;
});

export const CurrentNeedsProfile = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): NeedsProfileClaims => {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!req.needsProfile) throw new Error("CurrentNeedsProfile used outside a NeedsProfileGuard route.");
    return req.needsProfile;
  },
);
