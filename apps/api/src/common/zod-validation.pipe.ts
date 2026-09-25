import { PipeTransform } from "@nestjs/common";
import { ZodSchema } from "zod";
import { ApiError } from "./api-error";

export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema) {}

  transform(value: unknown): unknown {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new ApiError(400, "VALIDATION_FAILED", "Validation failed", {
        issues: result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    return result.data;
  }
}
