import { HttpException } from "@nestjs/common";

// Codes from components/schemas/ErrorCode in docs/phase-2/openapi.yaml (plus the two Phase 3
// amendments NOT_FOUND and INTERNAL_ERROR).
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
