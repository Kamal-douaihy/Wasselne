import { Inject, Injectable } from "@nestjs/common";
import jwt from "jsonwebtoken";
import { ENV } from "../../config/env.module";
import { Env } from "../../config/env";

export type AppKind = "RIDER" | "DRIVER";

export interface AccessTokenClaims {
  sub: string; // account id
  app: AppKind;
  sid: string; // session id
}

export interface NeedsProfileClaims {
  phone: string; // E.164; the token is only ever held by the client that just proved the number
  app: AppKind;
  cid: string; // challenge id that was consumed to mint it
}

// Audiences keep the two token kinds non-interchangeable even though they share a secret.
const ACCESS_AUD = "wasselne:access";
const NEEDS_PROFILE_AUD = "wasselne:needs-profile";

@Injectable()
export class JwtService {
  constructor(@Inject(ENV) private readonly env: Env) {}

  signAccessToken(claims: AccessTokenClaims): { token: string; expiresAt: Date } {
    const token = jwt.sign(claims, this.env.JWT_ACCESS_SECRET, {
      expiresIn: this.env.JWT_ACCESS_TTL_S,
      audience: ACCESS_AUD,
    });
    return { token, expiresAt: new Date(Date.now() + this.env.JWT_ACCESS_TTL_S * 1000) };
  }

  verifyAccessToken(token: string): AccessTokenClaims {
    return jwt.verify(token, this.env.JWT_ACCESS_SECRET, { audience: ACCESS_AUD }) as AccessTokenClaims;
  }

  signNeedsProfileToken(claims: NeedsProfileClaims): string {
    return jwt.sign(claims, this.env.JWT_ACCESS_SECRET, {
      expiresIn: this.env.NEEDS_PROFILE_TTL_S,
      audience: NEEDS_PROFILE_AUD,
    });
  }

  verifyNeedsProfileToken(token: string): NeedsProfileClaims {
    return jwt.verify(token, this.env.JWT_ACCESS_SECRET, { audience: NEEDS_PROFILE_AUD }) as NeedsProfileClaims;
  }
}
