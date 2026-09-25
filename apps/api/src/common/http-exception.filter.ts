import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from "@nestjs/common";
import { Request, Response } from "express";
import { ApiError, ErrorCode } from "./api-error";

const CODE_BY_STATUS: Record<number, ErrorCode> = {
  400: "VALIDATION_FAILED",
  401: "NOT_AUTHENTICATED",
  403: "NOT_AUTHORIZED",
  404: "NOT_FOUND",
  429: "RATE_LIMITED",
  503: "PROVIDER_TEMPORARY_FAILURE",
};

// Emits the contract's Error schema: { code, message, correlation_id, details? } (flat, no
// wrapper). Messages are English-only for now; per-language messages are Phase 4 work.
// Uses @nestjs/common's Logger, not nestjs-pino's PinoLogger, which is undefined when a global
// APP_FILTER is instantiated (see README "Known local-environment notes").
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request & { id?: string }>();
    const res = ctx.getResponse<Response>();
    const correlationId = String(req.id ?? res.getHeader("x-correlation-id") ?? "");

    const { status, code, message, details, retryAfter } = this.normalize(exception);
    if (status >= 500) {
      this.logger.error(`unhandled exception correlation_id=${correlationId}`, (exception as Error)?.stack);
    }
    res.setHeader("X-Correlation-Id", correlationId);
    if (retryAfter !== undefined) res.setHeader("Retry-After", String(retryAfter));
    res.status(status).json({ code, message, correlation_id: correlationId, ...(details ? { details } : {}) });
  }

  private normalize(exception: unknown) {
    if (exception instanceof ApiError) {
      return {
        status: exception.getStatus(),
        code: exception.code,
        message: exception.message,
        details: exception.details,
        retryAfter: exception.retryAfterSeconds,
      };
    }
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code = CODE_BY_STATUS[status] ?? (status >= 500 ? "INTERNAL_ERROR" : "VALIDATION_FAILED");
      return { status, code, message: exception.message, details: undefined, retryAfter: undefined };
    }
    // body-parser and friends throw plain errors carrying a 4xx status.
    const status = (exception as { status?: number })?.status;
    if (typeof status === "number" && status >= 400 && status < 500) {
      return {
        status,
        code: CODE_BY_STATUS[status] ?? "VALIDATION_FAILED",
        message: "The request could not be processed.",
        details: undefined,
        retryAfter: undefined,
      };
    }
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: "INTERNAL_ERROR" as const,
      message: "Something went wrong.",
      details: undefined,
      retryAfter: undefined,
    };
  }
}
