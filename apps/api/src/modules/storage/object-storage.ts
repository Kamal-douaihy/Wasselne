import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Inject, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { ENV } from "../../config/env.module";
import { Env } from "../../config/env";

export interface ObjectHead {
  sizeBytes: number;
  contentType: string | undefined;
}

// Private bucket only: there is no public URL anywhere. Uploads go to a presigned PUT on a staging
// key and are copied server-side to their final key; downloads go to a short-lived presigned GET
// issued after an authorization (and audit) check.
@Injectable()
export class ObjectStorage {
  private readonly internal: S3Client;
  private readonly signer: S3Client;

  constructor(@Inject(ENV) private readonly env: Env) {
    const base = {
      region: env.S3_REGION,
      forcePathStyle: true,
      credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
    };
    this.internal = new S3Client({ ...base, endpoint: env.S3_ENDPOINT });
    this.signer = new S3Client({ ...base, endpoint: env.S3_PUBLIC_ENDPOINT ?? env.S3_ENDPOINT });
  }

  key(relative: string): string {
    return this.env.S3_KEY_PREFIX + relative;
  }

  async presignPut(objectKey: string, contentType: string, ttlSeconds: number): Promise<string> {
    return getSignedUrl(
      this.signer,
      new PutObjectCommand({ Bucket: this.env.S3_BUCKET, Key: objectKey, ContentType: contentType }),
      { expiresIn: ttlSeconds, signableHeaders: new Set(["content-type"]) },
    );
  }

  async presignGet(objectKey: string, ttlSeconds: number): Promise<string> {
    return getSignedUrl(this.signer, new GetObjectCommand({ Bucket: this.env.S3_BUCKET, Key: objectKey }), {
      expiresIn: ttlSeconds,
    });
  }

  async head(objectKey: string): Promise<ObjectHead | null> {
    try {
      const out = await this.internal.send(new HeadObjectCommand({ Bucket: this.env.S3_BUCKET, Key: objectKey }));
      return { sizeBytes: Number(out.ContentLength ?? 0), contentType: out.ContentType };
    } catch (err) {
      const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 404) return null;
      throw err;
    }
  }

  /** First `n` bytes, for magic-number checks. */
  async readHead(objectKey: string, n: number): Promise<Buffer> {
    const out = await this.internal.send(
      new GetObjectCommand({ Bucket: this.env.S3_BUCKET, Key: objectKey, Range: `bytes=0-${n - 1}` }),
    );
    return Buffer.from(await out.Body!.transformToByteArray());
  }

  async sha256(objectKey: string): Promise<string> {
    const out = await this.internal.send(new GetObjectCommand({ Bucket: this.env.S3_BUCKET, Key: objectKey }));
    const hash = createHash("sha256");
    for await (const chunk of out.Body as AsyncIterable<Uint8Array>) hash.update(chunk);
    return hash.digest("hex");
  }

  /** Server-side copy within the bucket; metadata (including Content-Type) is copied as is. */
  async copy(sourceKey: string, destKey: string): Promise<void> {
    await this.internal.send(
      new CopyObjectCommand({ Bucket: this.env.S3_BUCKET, Key: destKey, CopySource: encodeURI(`${this.env.S3_BUCKET}/${sourceKey}`) }),
    );
  }

  async delete(objectKey: string): Promise<void> {
    await this.internal.send(new DeleteObjectCommand({ Bucket: this.env.S3_BUCKET, Key: objectKey }));
  }
}
