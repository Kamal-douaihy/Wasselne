import { z } from "zod";
import { ApiError } from "./api-error";

// Opaque keyset cursor: base64url(JSON). Clients must not parse it.
export const encodeCursor = (v: Record<string, string>): string => Buffer.from(JSON.stringify(v)).toString("base64url");

export function decodeCursor<T extends Record<string, string>>(raw: string | undefined, keys: (keyof T & string)[]): T | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Record<string, unknown>;
    for (const k of keys) if (typeof parsed[k] !== "string") throw new Error("bad key");
    return parsed as T;
  } catch {
    throw new ApiError(400, "VALIDATION_FAILED", "Invalid cursor.", { issues: [{ path: "cursor", message: "invalid" }] });
  }
}

export const pageQuerySchema = z.object({
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(100).optional(),
});
export type PageQuery = z.infer<typeof pageQuerySchema>;
