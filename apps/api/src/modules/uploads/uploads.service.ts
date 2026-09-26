import { Inject, Injectable } from "@nestjs/common";
import { Kysely, sql } from "kysely";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ApiError } from "../../common/api-error";
import { RateLimiter } from "../../common/rate-limiter";
import { ENV } from "../../config/env.module";
import { Env } from "../../config/env";
import { DB } from "../../db/db.module";
import { Database } from "../../db/schema-types";
import { AccessTokenClaims } from "../identity/jwt.service";
import { ObjectStorage } from "../storage/object-storage";
import { ALLOWED_TYPES, matchesMagic } from "./magic";

const MAX_BYTES_CAP = 26_214_400; // openapi UploadAuthorizeBody.max_bytes maximum
// Purposes implemented so far. VEHICLE_CHECK / CASE_EVIDENCE arrive with the phases that use them.
const PURPOSES_BY_APP = { DRIVER: ["DRIVER_DOCUMENT", "PROFILE_PHOTO"], RIDER: ["PROFILE_PHOTO"] } as const;
const COMPLETE_GRACE_S = 300;

export const uploadAuthorizeSchema = z.object({
  purpose: z.enum(["DRIVER_DOCUMENT", "PROFILE_PHOTO", "VEHICLE_CHECK", "CASE_EVIDENCE"]),
  content_type: z.string().min(1).max(100),
  max_bytes: z.number().int().positive().max(MAX_BYTES_CAP),
});
export type UploadAuthorizeDto = z.infer<typeof uploadAuthorizeSchema>;

@Injectable()
export class UploadsService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(ObjectStorage) private readonly storage: ObjectStorage,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async authorize(auth: AccessTokenClaims, dto: UploadAuthorizeDto) {
    const allowedPurposes: readonly string[] = PURPOSES_BY_APP[auth.app];
    if (!allowedPurposes.includes(dto.purpose)) {
      throw new ApiError(400, "UPLOAD_INVALID", "This kind of upload is not available.");
    }
    if (!(ALLOWED_TYPES as readonly string[]).includes(dto.content_type)) {
      throw new ApiError(400, "UPLOAD_INVALID", "This file type is not accepted.", { allowed_content_types: ALLOWED_TYPES });
    }
    if (dto.content_type === "application/pdf" && dto.purpose !== "DRIVER_DOCUMENT") {
      throw new ApiError(400, "UPLOAD_INVALID", "PDF is only accepted for documents.");
    }
    await this.limiter.enforce(this.limiter.key("rl", "upload-auth", auth.sub), 60, 3600, "RATE_LIMITED", "Too many uploads. Try again later.");

    const id = randomUUID();
    // The client only ever gets a PUT URL for the staging key. The final key is random, is never
    // returned and never signed for writing, so the bytes stored there cannot be replaced by
    // reusing the PUT URL after completion (it stays valid until the grant TTL runs out).
    const stagingKey = this.storage.key(`staging/${auth.sub}/${id}`);
    const objectKey = this.storage.key(`uploads/${auth.sub}/${randomUUID()}`);
    const row = await this.db
      .insertInto("uploads")
      .values({
        id,
        owner_account_id: auth.sub,
        purpose: dto.purpose,
        object_key: objectKey,
        staging_object_key: stagingKey,
        content_type: dto.content_type,
        max_bytes: dto.max_bytes,
        size_bytes: null,
        sha256: null,
        completed_at: null,
        expires_at: sql`now() + make_interval(secs => ${this.env.UPLOAD_GRANT_TTL_S})` as never,
      })
      .returning(["id", "expires_at"])
      .executeTakeFirstOrThrow();
    const putUrl = await this.storage.presignPut(stagingKey, dto.content_type, this.env.UPLOAD_GRANT_TTL_S);
    return {
      upload_id: row.id,
      put_url: putUrl,
      required_headers: { "Content-Type": dto.content_type },
      expires_at: new Date(row.expires_at as unknown as string).toISOString(),
    };
  }

  /**
   * Copies the staged object to its final key and confirms the copy looks like what was declared.
   * Every check (size, magic bytes, sha256) reads the copy, not the staging object, so a PUT that
   * lands on the staging key during or after completion never reaches the stored file. This checks
   * size and magic bytes only: there is no antivirus/malware scan in this phase (register
   * TBD-4-03), and the response never says otherwise.
   */
  async complete(auth: AccessTokenClaims, uploadId: string) {
    type Result = { kind: "ok" | "rejected" | "expired"; body: Record<string, unknown>; reason?: string; copiedFrom?: string };
    const result = await this.db.transaction().execute(async (trx): Promise<Result> => {
      const up = await trx
        .selectFrom("uploads")
        .select(["id", "object_key", "staging_object_key", "content_type", "max_bytes", "status", "size_bytes", "sha256", sql<boolean>`now() > expires_at + make_interval(secs => ${COMPLETE_GRACE_S})`.as("too_late")])
        .where("id", "=", uploadId)
        .where("owner_account_id", "=", auth.sub)
        .forUpdate()
        .executeTakeFirst();
      if (!up) throw new ApiError(404, "NOT_FOUND", "Unknown upload.");
      const shape = (status: string, size: number | null, sha: string | null) => ({ upload_id: up.id, status, size_bytes: size, sha256: sha });
      if (up.status === "COMPLETED") return { kind: "ok", body: shape("COMPLETED", up.size_bytes, up.sha256) };
      if (up.status !== "AUTHORIZED") return { kind: "rejected", body: shape(up.status, null, null), reason: `Upload is ${up.status}.` };

      const staging = up.staging_object_key;
      // Grants from before migration 021 were closed by it; a NULL here means the sweep ran.
      if (!staging) return { kind: "expired", body: shape("EXPIRED", null, null), reason: "The upload window has closed." };
      const reject = async (status: "REJECTED" | "EXPIRED", reason: string): Promise<Result> => {
        await trx.updateTable("uploads").set({ status }).where("id", "=", up.id).execute();
        await this.storage.delete(staging).catch(() => undefined);
        await this.storage.delete(up.object_key).catch(() => undefined);
        return { kind: status === "EXPIRED" ? "expired" : "rejected", body: shape(status, null, null), reason };
      };
      if (up.too_late) return reject("EXPIRED", "The upload window has closed.");
      const staged = await this.storage.head(staging);
      if (!staged) throw new ApiError(422, "UPLOAD_INVALID", "No file has been uploaded for this grant yet.");
      // Cheap pre-check so an oversized object is not copied; the copy is checked again below.
      if (staged.sizeBytes <= 0 || staged.sizeBytes > up.max_bytes) return reject("REJECTED", "The file size is not allowed.");

      await this.storage.copy(staging, up.object_key);
      const head = await this.storage.head(up.object_key);
      if (!head || head.sizeBytes <= 0 || head.sizeBytes > up.max_bytes) return reject("REJECTED", "The file size is not allowed.");
      const magic = await this.storage.readHead(up.object_key, 16);
      if (!matchesMagic(up.content_type, magic)) return reject("REJECTED", "The file content does not match its declared type.");
      const sha = await this.storage.sha256(up.object_key);
      await trx
        .updateTable("uploads")
        .set({ status: "COMPLETED", size_bytes: head.sizeBytes, sha256: sha, completed_at: sql`now()` as never })
        .where("id", "=", up.id)
        .execute();
      return { kind: "ok", body: shape("COMPLETED", head.sizeBytes, sha), copiedFrom: staging };
    });
    // After commit. Anything PUT to the staging key later, until the grant expires, is removed by
    // the cleanup job.
    if (result.copiedFrom) await this.storage.delete(result.copiedFrom).catch(() => undefined);
    if (result.kind !== "ok") throw new ApiError(422, "UPLOAD_INVALID", result.reason ?? "Upload rejected.", { status: result.body.status });
    return result.body;
  }
}
