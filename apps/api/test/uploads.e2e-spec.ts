// Presigned uploads against real MinIO: nothing here is mocked. The bucket is private, uploads are
// checked by size and magic bytes on completion, and only the owner can complete or use one.
import { createHash, randomBytes } from "node:crypto";
import { ObjectStorage } from "../src/modules/storage/object-storage";
import { JPEG, PNG, adminWith, onboardDriver, signUp, uploadFile } from "./support/fixtures";
import { TestContext, call, createTestContext } from "./support/test-app";

describe("uploads", () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestContext();
  });
  afterAll(() => ctx.close());

  it("authorize -> PUT -> complete stores the object and records size and sha256", async () => {
    const d = await signUp(ctx, "DRIVER");
    const { complete, uploadId } = await uploadFile(ctx, d.token, JPEG);
    expect(complete.status).toBe(200);
    expect(complete.body).toMatchObject({ upload_id: uploadId, status: "COMPLETED", size_bytes: JPEG.length });
    expect(complete.body.sha256).toBe(createHash("sha256").update(JPEG).digest("hex"));
    const row = await ctx.pool.query("select object_key, staging_object_key, status from uploads where id = $1", [uploadId]);
    expect(row.rows[0].object_key).toContain(`uploads/${d.accountId}/`);
    expect(row.rows[0].object_key).not.toContain(uploadId); // the final key is not derivable from the upload id
    expect(row.rows[0].staging_object_key).toContain(`staging/${d.accountId}/${uploadId}`);
    const storage = ctx.app.get(ObjectStorage);
    expect(await storage.head(row.rows[0].staging_object_key)).toBeNull(); // staging copy removed on completion
    expect(await storage.sha256(row.rows[0].object_key)).toBe(complete.body.sha256);
  });

  it("reusing the PUT URL after completion cannot change the bytes a reviewer downloads", async () => {
    const reviewer = await adminWith(ctx, ["DRIVER_REVIEWER"]);
    const s = await onboardDriver(ctx, { submit: false });
    const t = s.driver.token;
    const original = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(64)]);
    const up = await uploadFile(ctx, t, original);
    expect(up.complete.status).toBe(200);
    const attached = await call(ctx, "post", "/driver/onboarding/documents", { token: t, body: { document_type_id: s.docTypeIds[0], upload_id: up.uploadId } });
    expect(attached.status).toBe(201);

    // The PUT URL is a bearer capability and is still inside its TTL: storage accepts new bytes.
    const tampered = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(5000)]);
    const reput = await fetch(up.authorize.body.put_url, { method: "PUT", headers: up.authorize.body.required_headers, body: tampered });
    expect(reput.status).toBe(200);

    const dl = await call(ctx, "get", "/admin/driver-approvals/{id}/documents/{documentId}/download", { token: reviewer.token, params: { id: s.driver.accountId, documentId: attached.body.id } });
    expect(dl.status).toBe(200);
    const reviewed = Buffer.from(await (await fetch(dl.body.url)).arrayBuffer());
    expect(reviewed.equals(original)).toBe(true);
    expect(createHash("sha256").update(reviewed).digest("hex")).toBe(up.complete.body.sha256);

    // A repeated completion neither re-reads the staging object nor changes the record.
    const again = await call(ctx, "post", "/uploads/{id}/complete", { token: t, params: { id: up.uploadId } });
    expect(again.body).toMatchObject({ status: "COMPLETED", sha256: up.complete.body.sha256, size_bytes: original.length });
    const dl2 = await call(ctx, "get", "/admin/driver-approvals/{id}/documents/{documentId}/download", { token: reviewer.token, params: { id: s.driver.accountId, documentId: attached.body.id } });
    expect(Buffer.from(await (await fetch(dl2.body.url)).arrayBuffer()).equals(original)).toBe(true);

    // Once the grant has expired, the cleanup job deletes the re-PUT staging object; the reviewed object stays.
    const { UploadCleanupService } = await import("../src/modules/uploads/upload-cleanup.service");
    const storage = ctx.app.get(ObjectStorage);
    const row = (await ctx.pool.query("select object_key, staging_object_key from uploads where id = $1", [up.uploadId])).rows[0];
    expect(await storage.head(row.staging_object_key)).not.toBeNull();
    await ctx.pool.query("update uploads set expires_at = now() - interval '1 hour' where id = $1", [up.uploadId]);
    await ctx.app.get(UploadCleanupService).sweepAbandoned();
    expect(await storage.head(row.staging_object_key)).toBeNull();
    expect((await ctx.pool.query("select status, staging_object_key from uploads where id = $1", [up.uploadId])).rows[0]).toEqual({ status: "COMPLETED", staging_object_key: null });
    expect(await storage.sha256(row.object_key)).toBe(up.complete.body.sha256);
  });

  it("complete is idempotent", async () => {
    const d = await signUp(ctx, "DRIVER");
    const first = await uploadFile(ctx, d.token, PNG, "image/png");
    const again = await call(ctx, "post", "/uploads/{id}/complete", { token: d.token, params: { id: first.uploadId } });
    expect(again.status).toBe(200);
    expect(again.body.status).toBe("COMPLETED");
  });

  it("the presigned URL is scoped to one key and one content type: a wrong Content-Type is refused by storage", async () => {
    const d = await signUp(ctx, "DRIVER");
    const auth = await call(ctx, "post", "/uploads/authorize", { token: d.token, body: { purpose: "DRIVER_DOCUMENT", content_type: "image/jpeg", max_bytes: 5000 } });
    const put = await fetch(auth.body.put_url, { method: "PUT", headers: { "Content-Type": "text/html" }, body: JPEG });
    expect(put.status).toBe(403);
  });

  it("the bucket is private: an unsigned GET of an uploaded object is refused", async () => {
    const d = await signUp(ctx, "DRIVER");
    const auth = await call(ctx, "post", "/uploads/authorize", { token: d.token, body: { purpose: "DRIVER_DOCUMENT", content_type: "image/jpeg", max_bytes: 5000 } });
    await fetch(auth.body.put_url, { method: "PUT", headers: auth.body.required_headers, body: JPEG });
    const unsigned = await fetch(String(auth.body.put_url).split("?")[0]!);
    expect(unsigned.status).toBe(403);
  });

  it("content that does not match its declared type is rejected and the object is deleted", async () => {
    const d = await signUp(ctx, "DRIVER");
    const exe = Buffer.concat([Buffer.from("MZ"), randomBytes(200)]);
    const auth = await call(ctx, "post", "/uploads/authorize", { token: d.token, body: { purpose: "DRIVER_DOCUMENT", content_type: "image/jpeg", max_bytes: 5000 } });
    await fetch(auth.body.put_url, { method: "PUT", headers: auth.body.required_headers, body: exe });
    const res = await call(ctx, "post", "/uploads/{id}/complete", { token: d.token, params: { id: auth.body.upload_id } });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("UPLOAD_INVALID");
    const row = await ctx.pool.query("select status, object_key, staging_object_key from uploads where id = $1", [auth.body.upload_id]);
    expect(row.rows[0].status).toBe("REJECTED");
    expect(await ctx.app.get(ObjectStorage).head(row.rows[0].object_key)).toBeNull();
    expect(await ctx.app.get(ObjectStorage).head(row.rows[0].staging_object_key)).toBeNull();
    const retry = await call(ctx, "post", "/uploads/{id}/complete", { token: d.token, params: { id: auth.body.upload_id } });
    expect(retry.status).toBe(422);
  });

  it("a file larger than max_bytes is rejected on completion", async () => {
    const d = await signUp(ctx, "DRIVER");
    const auth = await call(ctx, "post", "/uploads/authorize", { token: d.token, body: { purpose: "DRIVER_DOCUMENT", content_type: "image/jpeg", max_bytes: 100 } });
    await fetch(auth.body.put_url, { method: "PUT", headers: auth.body.required_headers, body: Buffer.concat([JPEG, randomBytes(500)]) });
    const res = await call(ctx, "post", "/uploads/{id}/complete", { token: d.token, params: { id: auth.body.upload_id } });
    expect(res.status).toBe(422);
    const row = await ctx.pool.query("select status from uploads where id = $1", [auth.body.upload_id]);
    expect(row.rows[0].status).toBe("REJECTED");
  });

  it("completing before anything was uploaded is 422 and leaves the grant usable", async () => {
    const d = await signUp(ctx, "DRIVER");
    const auth = await call(ctx, "post", "/uploads/authorize", { token: d.token, body: { purpose: "DRIVER_DOCUMENT", content_type: "image/jpeg", max_bytes: 5000 } });
    const early = await call(ctx, "post", "/uploads/{id}/complete", { token: d.token, params: { id: auth.body.upload_id } });
    expect(early.status).toBe(422);
    await fetch(auth.body.put_url, { method: "PUT", headers: auth.body.required_headers, body: JPEG });
    const later = await call(ctx, "post", "/uploads/{id}/complete", { token: d.token, params: { id: auth.body.upload_id } });
    expect(later.status).toBe(200);
  });

  it("an expired grant cannot be completed", async () => {
    const d = await signUp(ctx, "DRIVER");
    const auth = await call(ctx, "post", "/uploads/authorize", { token: d.token, body: { purpose: "DRIVER_DOCUMENT", content_type: "image/jpeg", max_bytes: 5000 } });
    await fetch(auth.body.put_url, { method: "PUT", headers: auth.body.required_headers, body: JPEG });
    await ctx.pool.query("update uploads set expires_at = now() - interval '1 hour' where id = $1", [auth.body.upload_id]);
    const res = await call(ctx, "post", "/uploads/{id}/complete", { token: d.token, params: { id: auth.body.upload_id } });
    expect(res.status).toBe(422);
    const row = await ctx.pool.query("select status from uploads where id = $1", [auth.body.upload_id]);
    expect(row.rows[0].status).toBe("EXPIRED");
  });

  it("abandoned grants are expired and their objects deleted by the cleanup job; completed uploads are untouched", async () => {
    const { UploadCleanupService } = await import("../src/modules/uploads/upload-cleanup.service");
    const d = await signUp(ctx, "DRIVER");
    const storage = ctx.app.get(ObjectStorage);
    const abandoned = await call(ctx, "post", "/uploads/authorize", { token: d.token, body: { purpose: "DRIVER_DOCUMENT", content_type: "image/jpeg", max_bytes: 5000 } });
    await fetch(abandoned.body.put_url, { method: "PUT", headers: abandoned.body.required_headers, body: JPEG }); // uploaded, never completed
    const fresh = await call(ctx, "post", "/uploads/authorize", { token: d.token, body: { purpose: "DRIVER_DOCUMENT", content_type: "image/jpeg", max_bytes: 5000 } });
    const done = await uploadFile(ctx, d.token, JPEG);
    const key = (id: string) => ctx.pool.query("select object_key from uploads where id = $1", [id]).then((r) => r.rows[0].object_key as string);
    const stagingKey = (id: string) => ctx.pool.query("select staging_object_key from uploads where id = $1", [id]).then((r) => r.rows[0].staging_object_key as string);
    const abandonedStaging = await stagingKey(abandoned.body.upload_id);
    expect(await storage.head(abandonedStaging)).not.toBeNull();
    await ctx.pool.query("update uploads set expires_at = now() - interval '1 hour' where id = $1", [abandoned.body.upload_id]);
    await ctx.pool.query("update uploads set expires_at = now() - interval '1 hour' where id = $1", [done.uploadId]); // completed: must survive

    const svc = ctx.app.get(UploadCleanupService);
    expect(await svc.sweepAbandoned()).toBe(1);
    expect(await storage.head(abandonedStaging)).toBeNull();
    expect(await stagingKey(abandoned.body.upload_id)).toBeNull();
    expect((await ctx.pool.query("select status from uploads where id = $1", [abandoned.body.upload_id])).rows[0].status).toBe("EXPIRED");
    expect((await ctx.pool.query("select status from uploads where id = $1", [fresh.body.upload_id])).rows[0].status).toBe("AUTHORIZED"); // still inside its window
    expect((await ctx.pool.query("select status from uploads where id = $1", [done.uploadId])).rows[0].status).toBe("COMPLETED");
    expect(await storage.head(await key(done.uploadId))).not.toBeNull();
    expect(await svc.sweepAbandoned()).toBe(0);
  });

  it("another account cannot complete someone else's upload (404, and the upload is untouched)", async () => {
    const a = await signUp(ctx, "DRIVER");
    const b = await signUp(ctx, "DRIVER");
    const auth = await call(ctx, "post", "/uploads/authorize", { token: a.token, body: { purpose: "DRIVER_DOCUMENT", content_type: "image/jpeg", max_bytes: 5000 } });
    await fetch(auth.body.put_url, { method: "PUT", headers: auth.body.required_headers, body: JPEG });
    const res = await call(ctx, "post", "/uploads/{id}/complete", { token: b.token, params: { id: auth.body.upload_id } });
    expect(res.status).toBe(404);
    const row = await ctx.pool.query("select status from uploads where id = $1", [auth.body.upload_id]);
    expect(row.rows[0].status).toBe("AUTHORIZED");
  });

  it("authorize validates purpose, type and size", async () => {
    const d = await signUp(ctx, "DRIVER");
    const r = await signUp(ctx, "RIDER");
    const bad = [
      { token: d.token, body: { purpose: "DRIVER_DOCUMENT", content_type: "application/x-msdownload", max_bytes: 1000 } },
      { token: d.token, body: { purpose: "DRIVER_DOCUMENT", content_type: "image/jpeg", max_bytes: 26_214_401 } },
      { token: d.token, body: { purpose: "DRIVER_DOCUMENT", content_type: "image/jpeg", max_bytes: 0 } },
      { token: d.token, body: { purpose: "PROFILE_PHOTO", content_type: "application/pdf", max_bytes: 1000 } },
      { token: d.token, body: { purpose: "CASE_EVIDENCE", content_type: "image/jpeg", max_bytes: 1000 } },
      { token: r.token, body: { purpose: "DRIVER_DOCUMENT", content_type: "image/jpeg", max_bytes: 1000 } },
    ];
    for (const b of bad) expect((await call(ctx, "post", "/uploads/authorize", b)).status).toBe(400);
    expect((await call(ctx, "post", "/uploads/authorize", { body: { purpose: "DRIVER_DOCUMENT", content_type: "image/jpeg", max_bytes: 1000 } })).status).toBe(401);
  });

  it("PDF documents are accepted by their %PDF header", async () => {
    const d = await signUp(ctx, "DRIVER");
    const pdf = Buffer.concat([Buffer.from("%PDF-1.7\n"), randomBytes(100)]);
    const { complete } = await uploadFile(ctx, d.token, pdf, "application/pdf");
    expect(complete.status).toBe(200);
  });
});
