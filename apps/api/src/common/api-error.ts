import { HttpException } from "@nestjs/common";

// Codes from components/schemas/ErrorCode in docs/phase-2/openapi.yaml (plus the Phase 3 amendments
// NOT_FOUND and INTERNAL_ERROR and the Phase 4 amendments INVALID_STATE, ONBOARDING_INCOMPLETE).
export type ErrorCode =
  | "VALIDATION_FAILED"
  | "NOT_AUTHENTICATED"
  | "NOT_AUTHORIZED"
  | "ACCOUNT_BLOCKED"
  | "OTP_INVALID"
  | "OTP_EXPIRED"
  | "OTP_RATE_LIMITED"
  | "RATE_LIMITED"
  | "PROVIDER_TEMPORARY_FAILURE"
  | "TERMS_ACCEPTANCE_REQUIRED"
  | "CATEGORY_NOT_ELIGIBLE"
  | "DRIVER_NOT_ELIGIBLE"
  | "UPLOAD_INVALID"
  | "INVALID_STATE"
  | "ONBOARDING_INCOMPLETE"
  | "NOT_FOUND"
  | "INTERNAL_ERROR";

export class ApiError extends HttpException {
  constructor(
    status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
    readonly retryAfterSeconds?: number,
  ) {
    super(message, status);
  }
}
