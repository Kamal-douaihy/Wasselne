// Driver onboarding through the real endpoints, admin review, and the eligibility rule that every
// future offer depends on. Responses are contract-checked; eligibility is asserted against
// driver_ineligibility_reasons() and, for offers, against the ride_offers trigger.
import { randomUUID } from "node:crypto";
import {
  JPEG, adminWith, createRide, approveDriverViaApi, createCategory, createDocType, onboardDriver, requireDoc, signUp, uploadFile,
} from "./support/fixtures";
import { TestContext, call, createTestContext } from "./support/test-app";

describe("driver onboarding and eligibility", () => {
  let ctx: TestContext;
  let reviewer: { token: string; id: string };
  beforeAll(async () => {
    ctx = await createTestContext({ OTP_RESEND_INTERVAL_S: "0" });
    reviewer = await adminWith(ctx, ["DRIVER_REVIEWER"]);
  });
  afterAll(() => ctx.close());

  const reasons = async (driverId: string, categoryId: string): Promise<string[]> =>
    (await ctx.pool.query("select driver_ineligibility_reasons($1,$2) as r", [driverId, categoryId])).rows[0].r;
  const status = (t: string) => call(ctx, "get", "/driver/onboarding/status", { token: t });

  describe("the application", () => {
    it("options list only active categories with their required documents; rider tokens are refused", async () => {
      const d = await signUp(ctx, "DRIVER");
      const women = await createCategory(ctx, { women: true, min_year: 2016 });
      const hidden = await createCategory(ctx, { active: false });
      const doc = await createDocType(ctx, { subject: "VEHICLE", has_expiry: true });
      await requireDoc(ctx, women, doc);
      const res = await call(ctx, "get", "/driver/onboarding/options", { token: d.token });
      expect(res.status).toBe(200);
      const ids = res.body.categories.map((c: { id: string }) => c.id);
      expect(ids).toContain(women);
      expect(ids).not.toContain(hidden);
      const c = res.body.categories.find((x: { id: string }) => x.id === women);
      expect(c).toMatchObject({ female_drivers_only: true, min_vehicle_year: 2016 });
      expect(c.required_documents).toEqual([expect.objectContaining({ document_type_id: doc, subject: "VEHICLE", has_expiry: true })]);
      const rider = await signUp(ctx, "RIDER");
      expect((await call(ctx, "get", "/driver/onboarding/options", { token: rider.token })).status).toBe(403);
      expect((await call(ctx, "get", "/driver/onboarding/options")).status).toBe(401);
    });

    it("a fresh driver account starts in ONBOARDING with an empty checklist", async () => {
      const d = await signUp(ctx, "DRIVER");
      const res = await status(d.token);
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("ONBOARDING");
      expect(res.body.checklist).toMatchObject({ profile: true, vehicle: false, categories: false, documents_total: 0 });
    });

    it("walks the checklist step by step and refuses to submit while anything is missing", async () => {
      const cat = await createCategory(ctx);
      const idDoc = await createDocType(ctx);
      await requireDoc(ctx, cat, idDoc);
      const d = await signUp(ctx, "DRIVER");
      const early = await call(ctx, "post", "/driver/onboarding/submit", { token: d.token });
      expect(early.status).toBe(422);
      expect(early.body.code).toBe("ONBOARDING_INCOMPLETE");
      expect(early.body.details.missing).toEqual(["vehicle", "categories"]);

      const noVehicle = await call(ctx, "post", "/driver/onboarding/categories", { token: d.token, body: { category_ids: [cat] } });
      expect(noVehicle.status).toBe(422);

      await call(ctx, "post", "/driver/onboarding/vehicle", { token: d.token, body: { base_type: "CAR", make: "Kia", model: "Rio", year: 2019, color: "Grey", plate: "ab 123", seats: 4 } });
      const sel = await call(ctx, "post", "/driver/onboarding/categories", { token: d.token, body: { category_ids: [cat] } });
      expect(sel.body.checklist).toMatchObject({ vehicle: true, categories: true, documents_total: 1, documents_done: 0, documents_complete: false });

      const up = await uploadFile(ctx, d.token, JPEG);
      const attached = await call(ctx, "post", "/driver/onboarding/documents", { token: d.token, body: { document_type_id: idDoc, upload_id: up.uploadId } });
      expect(attached.status).toBe(201);
      expect(attached.body.status).toBe("UPLOADED");
      const submitted = await call(ctx, "post", "/driver/onboarding/submit", { token: d.token });
      expect(submitted.status).toBe(200);
      expect(submitted.body.status).toBe("SUBMITTED");
      expect(submitted.body.submitted_at).toBeTruthy();

      const locked = await call(ctx, "post", "/driver/onboarding/vehicle", { token: d.token, body: { base_type: "CAR", make: "X", model: "Y", color: "Z", plate: "ZZ 1", seats: 4 } });
      expect(locked.status).toBe(409);
      expect(locked.body.code).toBe("INVALID_STATE");
      expect((await call(ctx, "post", "/driver/onboarding/submit", { token: d.token })).status).toBe(409);
    });

    it("plates are normalised and unique among active vehicles, without revealing the owner", async () => {
      const a = await signUp(ctx, "DRIVER");
      const b = await signUp(ctx, "DRIVER");
      const body = { base_type: "CAR", make: "Kia", model: "Rio", color: "Grey", plate: " x  9001 ", seats: 4 };
      expect((await call(ctx, "post", "/driver/onboarding/vehicle", { token: a.token, body })).status).toBe(200);
      const dup = await call(ctx, "post", "/driver/onboarding/vehicle", { token: b.token, body: { ...body, plate: "X 9001" } });
      expect(dup.status).toBe(400);
      expect(JSON.stringify(dup.body)).not.toContain(a.accountId);
      const stored = await ctx.pool.query("select plate from vehicles where driver_id = $1", [a.accountId]);
      expect(stored.rows[0].plate).toBe("X 9001");
    });

    it("category selection enforces the vehicle type, seats, minimum year and women-only rule", async () => {
      const d = await signUp(ctx, "DRIVER", { gender: "MALE" });
      await call(ctx, "post", "/driver/onboarding/vehicle", { token: d.token, body: { base_type: "CAR", make: "Kia", model: "Rio", year: 2012, color: "Grey", plate: `P${randomUUID().slice(0, 6)}`, seats: 4 } });
      const moto = await createCategory(ctx, { base_type: "MOTORCYCLE", seats: 1 });
      const big = await createCategory(ctx, { seats: 7 });
      const newer = await createCategory(ctx, { min_year: 2018 });
      const women = await createCategory(ctx, { women: true });
      const inactive = await createCategory(ctx, { active: false });
      const cases: [string, number, string | undefined][] = [
        [moto, 403, "VEHICLE_TYPE"], [big, 403, "SEATS"], [newer, 403, "VEHICLE_YEAR"], [women, 403, "WOMEN_ONLY"], [inactive, 400, undefined],
      ];
      for (const [id, code, why] of cases) {
        const res = await call(ctx, "post", "/driver/onboarding/categories", { token: d.token, body: { category_ids: [id] } });
        expect(res.status).toBe(code);
        if (why) {
          expect(res.body.code).toBe("CATEGORY_NOT_ELIGIBLE");
          expect(res.body.details.reason).toBe(why);
        }
      }
      expect((await call(ctx, "post", "/driver/onboarding/categories", { token: d.token, body: { category_ids: [randomUUID()] } })).status).toBe(400);
      expect((await call(ctx, "post", "/driver/onboarding/categories", { token: d.token, body: { category_ids: [] } })).status).toBe(400);
    });

    it("editing the vehicle to fewer seats or an older year drops the selections it no longer fits", async () => {
      const cases: [{ seats?: number; min_year?: number }, { seats?: number; year?: number }][] = [
        [{ seats: 4 }, { seats: 3 }],
        [{ min_year: 2018 }, { year: 2015 }],
      ];
      for (const [category, change] of cases) {
        const s = await onboardDriver(ctx, { category, submit: false });
        const t = s.driver.token;
        expect((await status(t)).body.checklist.categories).toBe(true);
        const plate = (await ctx.pool.query("select v.plate from vehicles v join driver_profiles p on p.current_vehicle_id = v.id where p.account_id = $1", [s.driver.accountId])).rows[0].plate;
        const edited = await call(ctx, "post", "/driver/onboarding/vehicle", {
          token: t, body: { base_type: "CAR", make: "Kia", model: "Rio", year: 2020, color: "Grey", plate, seats: 4, ...change },
        });
        expect(edited.status).toBe(200);
        expect(edited.body.categories).toEqual([]);
        expect(edited.body.checklist.categories).toBe(false);
        const submit = await call(ctx, "post", "/driver/onboarding/submit", { token: t });
        expect(submit.status).toBe(422);
        expect(submit.body.details.missing).toContain("categories");
      }
    });

    it("documents: must be required, completed, owned, unexpired; vehicle docs bind to the current vehicle", async () => {
      const setup = await onboardDriver(ctx, { submit: false });
      const t = setup.driver.token;
      const [idDoc, regDoc] = setup.docTypeIds as [string, string];
      const unrelated = await createDocType(ctx);
      const up = await uploadFile(ctx, t, JPEG);

      const notRequired = await call(ctx, "post", "/driver/onboarding/documents", { token: t, body: { document_type_id: unrelated, upload_id: up.uploadId } });
      expect(notRequired.status).toBe(400);
      const noExpiry = await call(ctx, "post", "/driver/onboarding/documents", { token: t, body: { document_type_id: regDoc, upload_id: up.uploadId } });
      expect(noExpiry.status).toBe(400);
      const past = await call(ctx, "post", "/driver/onboarding/documents", { token: t, body: { document_type_id: regDoc, upload_id: up.uploadId, expires_on: "2020-01-01" } });
      expect(past.status).toBe(400);
      const spurious = await call(ctx, "post", "/driver/onboarding/documents", { token: t, body: { document_type_id: idDoc, upload_id: up.uploadId, expires_on: "2099-01-01" } });
      expect(spurious.status).toBe(400);
      const otherVehicle = await call(ctx, "post", "/driver/onboarding/documents", { token: t, body: { document_type_id: regDoc, upload_id: up.uploadId, expires_on: "2099-01-01", vehicle_id: randomUUID() } });
      expect(otherVehicle.status).toBe(400);

      const other = await signUp(ctx, "DRIVER");
      const foreign = await call(ctx, "post", "/driver/onboarding/documents", { token: other.token, body: { document_type_id: idDoc, upload_id: up.uploadId } });
      expect([400, 404]).toContain(foreign.status);

      const pending = await call(ctx, "post", "/uploads/authorize", { token: t, body: { purpose: "DRIVER_DOCUMENT", content_type: "image/jpeg", max_bytes: 1000 } });
      const unfinished = await call(ctx, "post", "/driver/onboarding/documents", { token: t, body: { document_type_id: idDoc, upload_id: pending.body.upload_id } });
      expect(unfinished.status).toBe(400);
      expect(unfinished.body.code).toBe("UPLOAD_INVALID");
    });

    it("replacing a document supersedes the old one; the same upload cannot be attached twice", async () => {
      const setup = await onboardDriver(ctx, { submit: false });
      const t = setup.driver.token;
      const idDoc = setup.docTypeIds[0]!;
      const before = await call(ctx, "get", "/driver/documents", { token: t });
      const first = before.body.find((d: { document_type_id: string }) => d.document_type_id === idDoc);
      const up = await uploadFile(ctx, t, JPEG);
      const second = await call(ctx, "post", "/driver/onboarding/documents", { token: t, body: { document_type_id: idDoc, upload_id: up.uploadId } });
      expect(second.status).toBe(201);
      const again = await call(ctx, "post", "/driver/onboarding/documents", { token: t, body: { document_type_id: idDoc, upload_id: up.uploadId } });
      expect(again.status).toBe(400);
      const stored = await ctx.pool.query("select status from driver_documents where id = $1", [first.id]);
      expect(stored.rows[0].status).toBe("SUPERSEDED");
      const after = await call(ctx, "get", "/driver/documents", { token: t });
      expect(after.body.filter((d: { document_type_id: string }) => d.document_type_id === idDoc)).toHaveLength(1);
    });

    it("a rider account that later signs in to the driver app can start an application", async () => {
      const rider = await signUp(ctx, "RIDER");
      const { signIn } = await import("./support/fixtures");
      const asDriver = await signIn(ctx, rider.phone, "DRIVER");
      expect((await status(asDriver.token)).status).toBe(404);
      const saved = await call(ctx, "post", "/driver/onboarding/profile", { token: asDriver.token, body: { first_name: "R", last_name: "D", gender: "MALE", accepted_legal_version_ids: [] } });
      expect(saved.status).toBe(200);
      expect(saved.body.status).toBe("ONBOARDING");
    });

    it("changing the declared gender voids a management confirmation", async () => {
      const d = await signUp(ctx, "DRIVER", { gender: "FEMALE" });
      await ctx.pool.query("update accounts set gender_confirmed_at = now() where id = $1", [d.accountId]);
      await call(ctx, "post", "/driver/onboarding/profile", { token: d.token, body: { first_name: "A", last_name: "B", gender: "FEMALE", accepted_legal_version_ids: [] } });
      expect((await ctx.pool.query("select gender_confirmed_at from accounts where id = $1", [d.accountId])).rows[0].gender_confirmed_at).not.toBeNull();
      await call(ctx, "post", "/driver/onboarding/profile", { token: d.token, body: { first_name: "A", last_name: "B", gender: "MALE", accepted_legal_version_ids: [] } });
      expect((await ctx.pool.query("select gender_confirmed_at from accounts where id = $1", [d.accountId])).rows[0].gender_confirmed_at).toBeNull();
    });
  });

  describe("review and approval", () => {
    it("approve: documents approved, driver approved, category approved, driver becomes eligible", async () => {
      const setup = await onboardDriver(ctx);
      const id = setup.driver.accountId;
      expect(await reasons(id, setup.categoryId)).toEqual(expect.arrayContaining(["DRIVER_NOT_APPROVED", "CATEGORY_NOT_APPROVED"]));

      const early = await call(ctx, "post", "/admin/driver-approvals/{id}/approve", { token: reviewer.token, params: { id }, body: { reason: "too early" } });
      expect(early.status).toBe(409); // documents are still UPLOADED, so no category can be approved
      expect(early.body.details.blocking[setup.categoryId]).toEqual(expect.arrayContaining([expect.stringMatching(/^DOCUMENT_NOT_VALID:/)]));

      await approveDriverViaApi(ctx, reviewer, id);
      expect(await reasons(id, setup.categoryId)).toEqual([]);
      const st = await status(setup.driver.token);
      expect(st.body.status).toBe("APPROVED");
      const detail = await call(ctx, "get", "/admin/drivers/{id}", { token: reviewer.token, params: { id } });
      expect(detail.body).toMatchObject({ status: "APPROVED", document_status: "COMPLETE" });
      expect(detail.body.qualified_categories).toHaveLength(1);
    });

    it("request-changes returns the application to the driver, who fixes it and resubmits", async () => {
      const setup = await onboardDriver(ctx);
      const id = setup.driver.accountId;
      const t = setup.driver.token;
      const docs = (await call(ctx, "get", "/driver/documents", { token: t })).body as { id: string; document_type_id: string }[];
      const target = docs[0]!;
      const sent = await call(ctx, "post", "/admin/driver-approvals/{id}/documents/{documentId}/request-changes", { token: reviewer.token, params: { id, documentId: target.id }, body: { reason: "photo is blurry" } });
      expect(sent.status).toBe(200);
      expect(sent.body).toMatchObject({ status: "NEEDS_CHANGES", review_reason: "photo is blurry" });
      const st = await status(t);
      expect(st.body).toMatchObject({ status: "NEEDS_CHANGES", status_reason: "photo is blurry" });
      expect(st.body.checklist.documents_complete).toBe(false);

      const cannotSubmit = await call(ctx, "post", "/driver/onboarding/submit", { token: t });
      expect(cannotSubmit.status).toBe(422);
      const up = await uploadFile(ctx, t, JPEG);
      const body: Record<string, unknown> = { document_type_id: target.document_type_id, upload_id: up.uploadId };
      const type = await ctx.pool.query("select has_expiry from document_types where id = $1", [target.document_type_id]);
      if (type.rows[0].has_expiry) body.expires_on = "2099-01-01";
      expect((await call(ctx, "post", "/driver/onboarding/documents", { token: t, body })).status).toBe(201);
      const again = await call(ctx, "post", "/driver/onboarding/submit", { token: t });
      expect(again.status).toBe(200);
      expect(again.body.status).toBe("SUBMITTED");
      await approveDriverViaApi(ctx, reviewer, id);
      expect(await reasons(id, setup.categoryId)).toEqual([]);
    });

    it("reject: reason required, application closed, categories rejected, never eligible", async () => {
      const setup = await onboardDriver(ctx);
      const id = setup.driver.accountId;
      const noReason = await call(ctx, "post", "/admin/driver-approvals/{id}/reject", { token: reviewer.token, params: { id }, body: {} });
      expect(noReason.status).toBe(400);
      const short = await call(ctx, "post", "/admin/driver-approvals/{id}/reject", { token: reviewer.token, params: { id }, body: { reason: "no" } });
      expect(short.status).toBe(400);
      expect((await call(ctx, "post", "/admin/driver-approvals/{id}/reject", { token: reviewer.token, params: { id }, body: { reason: "documents are forged" } })).status).toBe(200);
      expect((await status(setup.driver.token)).body).toMatchObject({ status: "REJECTED", status_reason: "documents are forged" });
      expect((await reasons(id, setup.categoryId))).toEqual(expect.arrayContaining(["DRIVER_NOT_APPROVED", "CATEGORY_NOT_APPROVED"]));
      expect((await call(ctx, "post", "/admin/driver-approvals/{id}/approve", { token: reviewer.token, params: { id }, body: { reason: "changed my mind" } })).status).toBe(409);
      expect((await call(ctx, "post", "/driver/onboarding/submit", { token: setup.driver.token })).status).toBe(409);
    });

    it("women-only category: approval needs the driver's gender to be confirmed by management (D-35, D-39)", async () => {
      const setup = await onboardDriver(ctx, { gender: "FEMALE", category: { women: true } });
      const id = setup.driver.accountId;
      const docs = (await call(ctx, "get", "/driver/documents", { token: setup.driver.token })).body as { id: string }[];
      for (const d of docs) await call(ctx, "post", "/admin/driver-approvals/{id}/documents/{documentId}/approve", { token: reviewer.token, params: { id, documentId: d.id }, body: { reason: "documents ok" } });
      const blocked = await call(ctx, "post", "/admin/driver-approvals/{id}/approve", { token: reviewer.token, params: { id }, body: { reason: "docs fine" } });
      expect(blocked.status).toBe(409);
      expect(blocked.body.details.blocking[setup.categoryId]).toContain("GENDER_NOT_CONFIRMED");

      const confirm = await call(ctx, "post", "/admin/drivers/{id}/gender-confirm", { token: reviewer.token, params: { id }, body: { confirmed_gender: "FEMALE", reason: "ID checked in person" } });
      expect(confirm.status).toBe(200);
      const ok = await call(ctx, "post", "/admin/driver-approvals/{id}/approve", { token: reviewer.token, params: { id }, body: { reason: "docs and gender fine" } });
      expect(ok.status).toBe(200);
      expect(await reasons(id, setup.categoryId)).toEqual([]);
    });

    it("women-only: confirming the gender as MALE leaves the driver ineligible", async () => {
      const setup = await onboardDriver(ctx, { gender: "FEMALE", category: { women: true } });
      const id = setup.driver.accountId;
      await call(ctx, "post", "/admin/drivers/{id}/gender-confirm", { token: reviewer.token, params: { id }, body: { confirmed_gender: "MALE", reason: "ID says male" } });
      const docs = (await call(ctx, "get", "/driver/documents", { token: setup.driver.token })).body as { id: string }[];
      for (const d of docs) await call(ctx, "post", "/admin/driver-approvals/{id}/documents/{documentId}/approve", { token: reviewer.token, params: { id, documentId: d.id }, body: { reason: "documents ok" } });
      expect((await call(ctx, "post", "/admin/driver-approvals/{id}/approve", { token: reviewer.token, params: { id }, body: { reason: "docs fine" } })).status).toBe(409);
    });

    it("the approval queue lists submitted applications oldest first, filterable, paginated", async () => {
      const a = await onboardDriver(ctx);
      const b = await onboardDriver(ctx);
      const q = await call(ctx, "get", "/admin/driver-approvals", { token: reviewer.token, query: { limit: 100 } });
      expect(q.status).toBe(200);
      const ids = q.body.items.map((i: { driver_id: string }) => i.driver_id);
      expect(ids).toEqual(expect.arrayContaining([a.driver.accountId, b.driver.accountId]));
      expect(ids.indexOf(a.driver.accountId)).toBeLessThan(ids.indexOf(b.driver.accountId));
      const item = q.body.items.find((i: { driver_id: string }) => i.driver_id === a.driver.accountId);
      expect(item).toMatchObject({ status: "PENDING", documents_total: 2, documents_ready: 0 });

      const filtered = await call(ctx, "get", "/admin/driver-approvals", { token: reviewer.token, query: { category_id: a.categoryId } });
      expect(filtered.body.items.map((i: { driver_id: string }) => i.driver_id)).toEqual([a.driver.accountId]);

      const p1 = await call(ctx, "get", "/admin/driver-approvals", { token: reviewer.token, query: { limit: 1 } });
      expect(p1.body.items).toHaveLength(1);
      expect(p1.body.next_cursor).toBeTruthy();
      const p2 = await call(ctx, "get", "/admin/driver-approvals", { token: reviewer.token, query: { limit: 1, cursor: p1.body.next_cursor } });
      expect(p2.body.items[0].driver_id).not.toBe(p1.body.items[0].driver_id);
      expect((await call(ctx, "get", "/admin/driver-approvals", { token: reviewer.token, query: { cursor: "garbage" } })).status).toBe(400);
      expect((await call(ctx, "get", "/admin/driver-approvals", { token: reviewer.token, query: { zone_id: randomUUID() } })).status).toBe(400);
    });

    it("editing a category: approving requires the requirements; rejecting revokes eligibility", async () => {
      const setup = await onboardDriver(ctx);
      const id = setup.driver.accountId;
      await approveDriverViaApi(ctx, reviewer, id);
      const rej = await call(ctx, "patch", "/admin/drivers/{id}/categories", { token: reviewer.token, params: { id }, body: { category_id: setup.categoryId, status: "REJECTED", reason: "vehicle too old" } });
      expect(rej.status).toBe(200);
      expect(await reasons(id, setup.categoryId)).toContain("CATEGORY_NOT_APPROVED");
      const back = await call(ctx, "patch", "/admin/drivers/{id}/categories", { token: reviewer.token, params: { id }, body: { category_id: setup.categoryId, status: "APPROVED", reason: "re-checked" } });
      expect(back.status).toBe(200);
      expect(await reasons(id, setup.categoryId)).toEqual([]);
      const paused = await call(ctx, "patch", "/admin/drivers/{id}/categories", { token: reviewer.token, params: { id }, body: { category_id: setup.categoryId, status: "PAUSED_BY_DRIVER", reason: "not for admins" } });
      expect(paused.status).toBe(400);
      const unknown = await call(ctx, "patch", "/admin/drivers/{id}/categories", { token: reviewer.token, params: { id }, body: { category_id: randomUUID(), status: "APPROVED", reason: "n/a" } });
      expect(unknown.status).toBe(404);
    });
  });

  describe("eligibility stays true only while the reasons stay clear", () => {
    async function approved() {
      const setup = await onboardDriver(ctx);
      await approveDriverViaApi(ctx, reviewer, setup.driver.accountId);
      return setup;
    }

    it("suspension removes eligibility; reinstatement restores it; only valid transitions are allowed", async () => {
      const s = await approved();
      const id = s.driver.accountId;
      expect((await call(ctx, "post", "/admin/drivers/{id}/reinstate", { token: reviewer.token, params: { id }, body: { reason: "not suspended" } })).status).toBe(409);
      expect((await call(ctx, "post", "/admin/drivers/{id}/suspend", { token: reviewer.token, params: { id }, body: { reason: "complaints pending review" } })).status).toBe(200);
      expect(await reasons(id, s.categoryId)).toContain("DRIVER_NOT_APPROVED");
      expect((await call(ctx, "post", "/admin/drivers/{id}/suspend", { token: reviewer.token, params: { id }, body: { reason: "twice" } })).status).toBe(409);
      expect((await call(ctx, "post", "/admin/drivers/{id}/reinstate", { token: reviewer.token, params: { id }, body: { reason: "review closed" } })).status).toBe(200);
      expect(await reasons(id, s.categoryId)).toEqual([]);
    });

    it("an expired document removes eligibility immediately, before any sweeper runs", async () => {
      const s = await approved();
      await ctx.pool.query("update driver_documents set expires_on = current_date - 3 where driver_id = $1 and expires_on is not null", [s.driver.accountId]);
      expect((await reasons(s.driver.accountId, s.categoryId)).some((r) => r.startsWith("DOCUMENT_NOT_VALID:"))).toBe(true);
      const list = await call(ctx, "get", "/driver/documents", { token: s.driver.token });
      expect(list.body.filter((d: { status: string }) => d.status === "EXPIRED")).toHaveLength(1);
      const detail = await call(ctx, "get", "/admin/drivers/{id}", { token: reviewer.token, params: { id: s.driver.accountId } });
      expect(detail.body.document_status).toBe("EXPIRED");
    });

    it("the expiry sweep marks stored status EXPIRED and is idempotent", async () => {
      const s = await approved();
      await ctx.pool.query("update driver_documents set expires_on = current_date - 3 where driver_id = $1 and expires_on is not null", [s.driver.accountId]);
      const { DocumentExpiryService } = await import("../src/modules/drivers/document-expiry.service");
      const svc = ctx.app.get(DocumentExpiryService);
      expect(await svc.expireDue()).toBeGreaterThanOrEqual(1);
      expect((await ctx.pool.query("select count(*)::int as n from driver_documents where driver_id = $1 and status = 'EXPIRED'", [s.driver.accountId])).rows[0].n).toBe(1);
      const second = await svc.expireDue();
      expect(second).toBe(0);
    });

    it("a document about to expire shows EXPIRING; renewing goes back to review and pauses eligibility until approved", async () => {
      const s = await approved();
      const id = s.driver.accountId;
      await ctx.pool.query("update driver_documents set expires_on = current_date + 10 where driver_id = $1 and expires_on is not null", [id]);
      const detail = await call(ctx, "get", "/admin/drivers/{id}", { token: reviewer.token, params: { id } });
      expect(detail.body.document_status).toBe("EXPIRING");
      expect(await reasons(id, s.categoryId)).toEqual([]); // still valid until the date passes

      const up = await uploadFile(ctx, s.driver.token, JPEG);
      const renew = await call(ctx, "post", "/driver/onboarding/documents", { token: s.driver.token, body: { document_type_id: s.docTypeIds[1], upload_id: up.uploadId, expires_on: "2099-01-01" } });
      expect(renew.status).toBe(201);
      // documented limitation (register TBD-4-02): the renewal is UPLOADED, so eligibility pauses until review
      expect((await reasons(id, s.categoryId)).some((r) => r.startsWith("DOCUMENT_NOT_VALID:"))).toBe(true);
      await call(ctx, "post", "/admin/driver-approvals/{id}/documents/{documentId}/approve", { token: reviewer.token, params: { id, documentId: renew.body.id }, body: { reason: "renewed" } });
      expect(await reasons(id, s.categoryId)).toEqual([]);
    });

    it("rejecting an approved document removes eligibility without touching the driver's status", async () => {
      const s = await approved();
      const id = s.driver.accountId;
      const docs = (await call(ctx, "get", "/driver/documents", { token: s.driver.token })).body as { id: string }[];
      const r = await call(ctx, "post", "/admin/driver-approvals/{id}/documents/{documentId}/reject", { token: reviewer.token, params: { id, documentId: docs[0]!.id }, body: { reason: "found to be forged" } });
      expect(r.status).toBe(200);
      expect((await reasons(id, s.categoryId)).length).toBeGreaterThan(0);
      expect((await status(s.driver.token)).body.status).toBe("APPROVED");
    });

    it("an overdue vehicle check blocks only after the grace period; a submitted check never blocks (D-40)", async () => {
      const s = await approved();
      const id = s.driver.accountId;
      const veh = (await ctx.pool.query("select current_vehicle_id as v from driver_profiles where account_id = $1", [id])).rows[0].v;
      const chk = (await ctx.pool.query("insert into vehicle_checks (vehicle_id, due_on) values ($1, current_date - 3) returning id", [veh])).rows[0].id;
      expect(await reasons(id, s.categoryId)).toEqual([]); // 3 days overdue, default grace 7
      await ctx.pool.query("update vehicle_checks set due_on = current_date - 30 where id = $1", [chk]);
      expect(await reasons(id, s.categoryId)).toContain("VEHICLE_CHECK_OVERDUE");
      await ctx.pool.query("update vehicle_checks set status = 'SUBMITTED' where id = $1", [chk]);
      expect(await reasons(id, s.categoryId)).toEqual([]);
      await ctx.pool.query("update vehicle_checks set status = 'NEEDS_CHANGES' where id = $1", [chk]);
      expect(await reasons(id, s.categoryId)).toContain("VEHICLE_CHECK_OVERDUE");
      await ctx.pool.query("delete from vehicle_checks where id = $1", [chk]);
    });

    it("the grace period comes from the published platform settings", async () => {
      const s = await approved();
      const id = s.driver.accountId;
      const veh = (await ctx.pool.query("select current_vehicle_id as v from driver_profiles where account_id = $1", [id])).rows[0].v;
      await ctx.pool.query("insert into vehicle_checks (vehicle_id, due_on) values ($1, current_date - 3)", [veh]);
      const cfg = (await ctx.pool.query(
        "insert into platform_settings_versions (settings, status, effective_at, published_by) values ('{\"vehicle_check_grace_days\": 1}', 'PUBLISHED', now() + interval '1 second', $1) returning id",
        [reviewer.id],
      )).rows[0].id;
      await new Promise((r) => setTimeout(r, 1200));
      try {
        expect(await reasons(id, s.categoryId)).toContain("VEHICLE_CHECK_OVERDUE");
      } finally {
        await ctx.pool.query("delete from platform_settings_versions where id = $1", [cfg]);
        await ctx.pool.query("delete from vehicle_checks where vehicle_id = $1", [veh]);
      }
    });

    it("a changed vehicle voids category approvals granted for the old one", async () => {
      const s = await approved();
      const id = s.driver.accountId;
      const other = (await ctx.pool.query(
        "insert into vehicles (driver_id, base_type, make, model, color, plate, seats) values ($1,'CAR','X','Y','Red',$2,4) returning id",
        [id, `N${Math.random().toString(36).slice(2, 8)}`],
      )).rows[0].id;
      await ctx.pool.query("update driver_profiles set current_vehicle_id = $2 where account_id = $1", [id, other]);
      expect(await reasons(id, s.categoryId)).toContain("CATEGORY_VEHICLE_CHANGED");
    });

    it("seats or year lowered on the vehicle after approval remove eligibility (whatever path changed them)", async () => {
      const s = await onboardDriver(ctx, { category: { min_year: 2018 } });
      await approveDriverViaApi(ctx, reviewer, s.driver.accountId);
      const id = s.driver.accountId;
      expect(await reasons(id, s.categoryId)).toEqual([]);
      const veh = (await ctx.pool.query("select current_vehicle_id as v from driver_profiles where account_id = $1", [id])).rows[0].v;
      await ctx.pool.query("update vehicles set seats = 3 where id = $1", [veh]);
      expect(await reasons(id, s.categoryId)).toEqual(["VEHICLE_CATEGORY_MISMATCH:SEATS"]);
      await ctx.pool.query("update vehicles set seats = 4, year = 2015 where id = $1", [veh]);
      expect(await reasons(id, s.categoryId)).toEqual(["VEHICLE_CATEGORY_MISMATCH:VEHICLE_YEAR"]);
      await ctx.pool.query("update vehicles set year = null where id = $1", [veh]);
      expect(await reasons(id, s.categoryId)).toEqual(["VEHICLE_CATEGORY_MISMATCH:VEHICLE_YEAR"]); // no year cannot meet a minimum year
      await ctx.pool.query("update vehicles set year = 2020 where id = $1", [veh]);
      expect(await reasons(id, s.categoryId)).toEqual([]);
    });

    it("category rules tightened after approval (seats, minimum year) remove eligibility at once", async () => {
      const s = await approved();
      const id = s.driver.accountId;
      await ctx.pool.query("update vehicle_categories set seats = 7 where id = $1", [s.categoryId]);
      expect(await reasons(id, s.categoryId)).toEqual(["VEHICLE_CATEGORY_MISMATCH:SEATS"]);
      await ctx.pool.query(`update vehicle_categories set seats = 4, vehicle_rules = '{"min_year": 2030}' where id = $1`, [s.categoryId]);
      expect(await reasons(id, s.categoryId)).toEqual(["VEHICLE_CATEGORY_MISMATCH:VEHICLE_YEAR"]);
      await ctx.pool.query(`update vehicle_categories set vehicle_rules = '{"min_year": "soon"}' where id = $1`, [s.categoryId]);
      expect(await reasons(id, s.categoryId)).toEqual(["VEHICLE_CATEGORY_MISMATCH:VEHICLE_YEAR"]); // malformed rule fails closed
      await ctx.pool.query(`update vehicle_categories set vehicle_rules = '{}' where id = $1`, [s.categoryId]);
      expect(await reasons(id, s.categoryId)).toEqual([]);
    });

    it("an inactive category makes nobody eligible for it", async () => {
      const s = await approved();
      await ctx.pool.query("update vehicle_categories set active = false where id = $1", [s.categoryId]);
      expect(await reasons(s.driver.accountId, s.categoryId)).toContain("CATEGORY_INACTIVE");
    });
  });

  describe("offers cannot be created for ineligible drivers (database trigger)", () => {
    async function rideFor(categoryId: string): Promise<string> {
      return createRide(ctx, (await signUp(ctx, "RIDER")).accountId, categoryId);
    }
    const offer = async (rideId: string, driverId: string, vehicleId: string, attempt = 1) =>
      ctx.pool.query(
        "insert into ride_offers (ride_id, driver_id, vehicle_id, attempt_no, driver_attempt_no, ack_deadline_at) values ($1,$2,$3,$4,1, now() + interval '5 seconds')",
        [rideId, driverId, vehicleId, attempt],
      );

    it("accepts an offer for an eligible driver and refuses the same driver once suspended, blocked or unapproved", async () => {
      const s = await onboardDriver(ctx);
      const id = s.driver.accountId;
      const vehicle = (await ctx.pool.query("select current_vehicle_id as v from driver_profiles where account_id = $1", [id])).rows[0].v;
      const ride = await rideFor(s.categoryId);

      await expect(offer(ride, id, vehicle)).rejects.toMatchObject({ code: "WE001" }); // not approved yet
      await approveDriverViaApi(ctx, reviewer, id);
      await expect(offer(ride, id, randomUUID())).rejects.toBeTruthy(); // wrong vehicle (FK or trigger)
      await offer(ride, id, vehicle);
      await ctx.pool.query("update ride_offers set state = 'CANCELLED', resolved_at = now(), end_reason = 'RIDE_CANCELLED' where ride_id = $1", [ride]);

      await call(ctx, "post", "/admin/drivers/{id}/suspend", { token: reviewer.token, params: { id }, body: { reason: "under review" } });
      await expect(offer(ride, id, vehicle, 2)).rejects.toMatchObject({ code: "WE001" });
      await call(ctx, "post", "/admin/drivers/{id}/reinstate", { token: reviewer.token, params: { id }, body: { reason: "cleared" } });
      await offer(ride, id, vehicle, 2);
      await ctx.pool.query("update ride_offers set state = 'CANCELLED', resolved_at = now(), end_reason = 'RIDE_CANCELLED' where ride_id = $1", [ride]);

      const ops = await adminWith(ctx, ["OPERATIONS"]);
      await call(ctx, "post", "/admin/drivers/{id}/block", { token: ops.token, params: { id }, body: { applies_to: ["DRIVER"], reason: "reported by riders" } });
      await expect(offer(ride, id, vehicle, 3)).rejects.toMatchObject({ code: "WE001" });
    });

    it("admin approval and offers are refused when the vehicle no longer fits the category (seats, year, tightened rules)", async () => {
      const cases: [string, (vehicleId: string, categoryId: string) => Promise<unknown>, string][] = [
        ["seats lowered", (v) => ctx.pool.query("update vehicles set seats = 2 where id = $1", [v]), "VEHICLE_CATEGORY_MISMATCH:SEATS"],
        ["year lowered", (v) => ctx.pool.query("update vehicles set year = 2010 where id = $1", [v]), "VEHICLE_CATEGORY_MISMATCH:VEHICLE_YEAR"],
        ["category seats raised", (_v, c) => ctx.pool.query("update vehicle_categories set seats = 6 where id = $1", [c]), "VEHICLE_CATEGORY_MISMATCH:SEATS"],
        ["category min_year raised", (_v, c) => ctx.pool.query(`update vehicle_categories set vehicle_rules = '{"min_year": 2024}' where id = $1`, [c]), "VEHICLE_CATEGORY_MISMATCH:VEHICLE_YEAR"],
      ];
      for (const [label, mutate, expected] of cases) {
        // Submitted application, documents approved: only the vehicle/category fit is wrong.
        const s = await onboardDriver(ctx, { category: { min_year: 2016 } });
        const id = s.driver.accountId;
        const vehicle = (await ctx.pool.query("select current_vehicle_id as v from driver_profiles where account_id = $1", [id])).rows[0].v;
        const docs = (await call(ctx, "get", "/admin/drivers/{id}", { token: reviewer.token, params: { id } })).body.documents as { id: string }[];
        for (const d of docs) {
          const r = await call(ctx, "post", "/admin/driver-approvals/{id}/documents/{documentId}/approve", { token: reviewer.token, params: { id, documentId: d.id }, body: { reason: "document verified" } });
          expect(r.status).toBe(200);
        }
        await mutate(vehicle, s.categoryId);
        const refused = await call(ctx, "post", "/admin/driver-approvals/{id}/approve", { token: reviewer.token, params: { id }, body: { reason: "all documents verified" } });
        expect([label, refused.status]).toEqual([label, 409]);
        expect(refused.body.details.blocking[s.categoryId]).toEqual([expected]); // the fit is the only thing wrong

        // Same driver already approved (as if the change came after approval): the offer trigger refuses.
        await ctx.pool.query("update driver_profiles set status = 'APPROVED' where account_id = $1", [id]);
        await ctx.pool.query("update driver_category_approvals set status = 'APPROVED' where driver_id = $1", [id]);
        expect(await reasons(id, s.categoryId)).toEqual([expected]);
        const ride = await rideFor(s.categoryId);
        await expect(offer(ride, id, vehicle)).rejects.toMatchObject({ code: "WE001", message: expect.stringContaining(expected) });
      }
    });

    it("a driver approved for category A is not eligible for category B", async () => {
      const s = await onboardDriver(ctx);
      await approveDriverViaApi(ctx, reviewer, s.driver.accountId);
      const otherCat = await createCategory(ctx);
      const vehicle = (await ctx.pool.query("select current_vehicle_id as v from driver_profiles where account_id = $1", [s.driver.accountId])).rows[0].v;
      const ride = await rideFor(otherCat);
      await expect(offer(ride, s.driver.accountId, vehicle)).rejects.toMatchObject({ code: "WE001" });
    });
  });
});
