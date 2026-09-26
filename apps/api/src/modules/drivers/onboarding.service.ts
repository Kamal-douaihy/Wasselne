import { Inject, Injectable } from "@nestjs/common";
import { Kysely, Transaction, sql } from "kysely";
import { ApiError } from "../../common/api-error";
import { DB } from "../../db/db.module";
import { Database, DocumentStatus, DriverStatus } from "../../db/schema-types";
import { LegalService } from "../identity/legal.service";
import { TODAY_BEIRUT } from "./document-expiry.service";
import { EligibilityService } from "./eligibility.service";
import { CategoriesDto, DocumentAttachDto, OnboardingProfileDto, VehicleDto } from "./onboarding.dto";

type Db = Kysely<Database> | Transaction<Database>;

export interface DriverDocumentView {
  id: string;
  document_type_code: string;
  document_type_names: unknown;
  document_type_id: string;
  vehicle_id: string | null;
  status: DocumentStatus;
  review_reason: string | null;
  expires_on: string | null;
}

// Statuses in which the driver may edit the application.
const EDITABLE: DriverStatus[] = ["ONBOARDING", "NEEDS_CHANGES"];

@Injectable()
export class OnboardingService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(LegalService) private readonly legal: LegalService,
    @Inject(EligibilityService) private readonly eligibility: EligibilityService,
  ) {}

  // ------------------------------------------------------------------ options

  /** Active categories with the documents each requires: everything comes from CMS tables. */
  async options() {
    const cats = await this.db.selectFrom("vehicle_categories").selectAll().where("active", "=", true).orderBy("sort_order").orderBy("code").execute();
    const reqs = await sql<{ category_id: string; id: string; code: string; names: unknown; subject: string; has_expiry: boolean; allow_gallery: boolean }>`
      select r.category_id, dt.id, dt.code, dt.names, dt.subject, dt.has_expiry, dt.allow_gallery
        from category_document_requirements r join document_types dt on dt.id = r.document_type_id and dt.active
       order by dt.code`.execute(this.db);
    return {
      categories: cats.map((c) => ({
        id: c.id,
        code: c.code,
        names: c.names,
        base_type: c.base_type,
        seats: c.seats,
        female_drivers_only: c.female_drivers_only,
        min_vehicle_year: ((c.vehicle_rules ?? {}) as { min_year?: number }).min_year ?? null,
        required_documents: reqs.rows
          .filter((r) => r.category_id === c.id)
          .map((r) => ({ document_type_id: r.id, code: r.code, names: r.names, subject: r.subject, has_expiry: r.has_expiry, allow_gallery: r.allow_gallery })),
      })),
    };
  }

  // ------------------------------------------------------------------ status

  async status(driverId: string) {
    return this.buildStatus(this.db, driverId);
  }

  private async today(db: Db): Promise<string> {
    const r = await sql<{ d: string }>`select ${TODAY_BEIRUT} as d`.execute(db);
    return r.rows[0]!.d;
  }

  /** Stored status, except that a document past its expiry date is shown as EXPIRED at once. */
  private effectiveStatus(status: DocumentStatus, expiresOn: string | null, today: string): DocumentStatus {
    return (status === "UPLOADED" || status === "APPROVED") && expiresOn !== null && expiresOn < today ? "EXPIRED" : status;
  }

  async listDocuments(db: Db, driverId: string): Promise<DriverDocumentView[]> {
    const today = await this.today(db);
    const rows = await db
      .selectFrom("driver_documents as d")
      .innerJoin("document_types as t", "t.id", "d.document_type_id")
      .select(["d.id", "d.document_type_id", "t.code as document_type_code", "t.names as document_type_names", "d.vehicle_id", "d.status", "d.review_reason", "d.expires_on"])
      .where("d.driver_id", "=", driverId)
      .where("d.status", "<>", "SUPERSEDED")
      .orderBy("d.created_at", "desc")
      .execute();
    return rows.map((r) => ({
      id: r.id,
      document_type_code: r.document_type_code,
      document_type_names: r.document_type_names,
      document_type_id: r.document_type_id,
      vehicle_id: r.vehicle_id,
      status: this.effectiveStatus(r.status, r.expires_on as string | null, today),
      review_reason: r.review_reason,
      expires_on: (r.expires_on as string | null) ?? null,
    }));
  }

  /** Required document types across the driver's not-rejected category selections. */
  async requiredTypes(db: Db, driverId: string) {
    const res = await sql<{ id: string; code: string; subject: "DRIVER" | "VEHICLE"; has_expiry: boolean }>`
      select distinct dt.id, dt.code, dt.subject, dt.has_expiry
        from driver_category_approvals a
        join category_document_requirements r on r.category_id = a.category_id
        join document_types dt on dt.id = r.document_type_id and dt.active
       where a.driver_id = ${driverId}::uuid and a.status <> 'REJECTED'`.execute(db);
    return res.rows;
  }

  private async buildStatus(db: Db, driverId: string) {
    const profile = await db.selectFrom("driver_profiles").selectAll().where("account_id", "=", driverId).executeTakeFirst();
    if (!profile) throw new ApiError(404, "NOT_FOUND", "No driver application yet. Save the profile step first.");
    const account = await db.selectFrom("accounts").select(["first_name", "last_name", "gender"]).where("id", "=", driverId).executeTakeFirstOrThrow();
    const documents = await this.listDocuments(db, driverId);
    const required = await this.requiredTypes(db, driverId);
    const categories = await db.selectFrom("driver_category_approvals").select(["category_id", "status", "reason"]).where("driver_id", "=", driverId).execute();
    // A selection counts only while the current vehicle still fits the category's current rules.
    let fittingCategories = 0;
    if (profile.current_vehicle_id) {
      for (const c of categories) {
        if (c.status !== "REJECTED" && (await this.eligibility.vehicleFit(profile.current_vehicle_id, c.category_id, db)).length === 0) fittingCategories += 1;
      }
    }
    const missingLegal = await this.legal.missingAcceptances(db, driverId, "DRIVER");

    const done = required.filter((t) =>
      documents.some(
        (d) =>
          d.document_type_id === t.id &&
          (d.status === "UPLOADED" || d.status === "APPROVED") &&
          (t.subject === "DRIVER" ? d.vehicle_id === null : d.vehicle_id === profile.current_vehicle_id),
      ),
    );
    return {
      status: profile.status,
      status_reason: profile.status_reason,
      submitted_at: profile.submitted_at ? new Date(profile.submitted_at as unknown as string).toISOString() : null,
      checklist: {
        profile: Boolean(account.first_name && account.last_name && account.gender) && missingLegal.length === 0,
        vehicle: profile.current_vehicle_id !== null,
        categories: fittingCategories > 0,
        documents_complete: done.length === required.length,
        documents_total: required.length,
        documents_done: done.length,
      },
      categories: categories.map((c) => ({ category_id: c.category_id, status: c.status, reason: c.reason })),
      documents,
    };
  }

  // ------------------------------------------------------------------ steps

  private async lockDriver(trx: Transaction<Database>, driverId: string) {
    const p = await trx.selectFrom("driver_profiles").selectAll().where("account_id", "=", driverId).forUpdate().executeTakeFirst();
    if (!p) throw new ApiError(404, "NOT_FOUND", "No driver application yet. Save the profile step first.");
    return p;
  }

  private assertEditable(status: DriverStatus, allowed: DriverStatus[] = EDITABLE): void {
    if (!allowed.includes(status)) {
      throw new ApiError(409, "INVALID_STATE", `The application cannot be changed while it is ${status}.`, { status });
    }
  }

  async saveProfile(driverId: string, dto: OnboardingProfileDto) {
    return this.db.transaction().execute(async (trx) => {
      // A rider who now wants to drive has no driver_profiles row yet; create it once.
      await trx
        .insertInto("driver_profiles")
        .values({ account_id: driverId, status: "ONBOARDING", status_reason: null, submitted_at: null, decided_at: null, decided_by: null, current_vehicle_id: null, rating_avg_bp: null })
        .onConflict((oc) => oc.column("account_id").doNothing())
        .execute();
      const profile = await this.lockDriver(trx, driverId);
      this.assertEditable(profile.status);

      const current = await this.legal.currentVersions(trx, "DRIVER");
      const currentIds = new Set(current.map((c) => c.id));
      const unknown = dto.accepted_legal_version_ids.filter((id) => !currentIds.has(id));
      if (unknown.length > 0) {
        throw new ApiError(400, "VALIDATION_FAILED", "Unknown or superseded legal document version.", { unknown_version_ids: unknown });
      }
      for (const versionId of new Set(dto.accepted_legal_version_ids)) {
        await trx
          .insertInto("legal_acceptances")
          .values({ account_id: driverId, version_id: versionId, app: "DRIVER" })
          .onConflict((oc) => oc.columns(["account_id", "version_id"]).doNothing())
          .execute();
      }

      const before = await trx.selectFrom("accounts").select("gender").where("id", "=", driverId).executeTakeFirstOrThrow();
      const patch: Record<string, unknown> = { first_name: dto.first_name, last_name: dto.last_name, gender: dto.gender };
      if (dto.email !== undefined) patch.email = dto.email;
      // The declared gender is confirmed by management (D-39); changing it voids that confirmation.
      if (before.gender !== dto.gender) {
        patch.gender_confirmed_at = null;
        patch.gender_confirmed_by = null;
      }
      await trx.updateTable("accounts").set(patch as never).where("id", "=", driverId).execute();
      return this.buildStatus(trx, driverId);
    });
  }

  async saveVehicle(driverId: string, dto: VehicleDto) {
    const plate = dto.plate.replace(/\s+/g, " ").toUpperCase();
    try {
      return await this.db.transaction().execute(async (trx) => {
        const profile = await this.lockDriver(trx, driverId);
        this.assertEditable(profile.status);
        const values = {
          base_type: dto.base_type,
          make: dto.make,
          model: dto.model,
          year: dto.year ?? null,
          color: dto.color,
          plate,
          seats: dto.seats,
        };
        if (profile.current_vehicle_id) {
          await trx.updateTable("vehicles").set(values).where("id", "=", profile.current_vehicle_id).execute();
          // Selections the edited vehicle no longer fits (type, seats or minimum year) are dropped;
          // the driver re-selects. Approved ones are left to the eligibility rule, which reads the
          // same vehicle_category_fit_reasons() on every approval and offer.
          await trx
            .deleteFrom("driver_category_approvals")
            .where("driver_id", "=", driverId)
            .where("status", "=", "PENDING")
            .where(sql<boolean>`cardinality(vehicle_category_fit_reasons(${profile.current_vehicle_id}::uuid, category_id)) > 0`)
            .execute();
        } else {
          const v = await trx.insertInto("vehicles").values({ ...values, driver_id: driverId }).returning("id").executeTakeFirstOrThrow();
          await trx.updateTable("driver_profiles").set({ current_vehicle_id: v.id }).where("account_id", "=", driverId).execute();
        }
        return this.buildStatus(trx, driverId);
      });
    } catch (err) {
      if ((err as { code?: string }).code === "23505") {
        // Deliberately does not say whose vehicle it is.
        throw new ApiError(400, "VALIDATION_FAILED", "This plate is already registered.", { issues: [{ path: "plate", message: "already registered" }] });
      }
      throw err;
    }
  }

  async selectCategories(driverId: string, dto: CategoriesDto) {
    return this.db.transaction().execute(async (trx) => {
      const profile = await this.lockDriver(trx, driverId);
      this.assertEditable(profile.status, ["ONBOARDING", "NEEDS_CHANGES", "APPROVED"]);
      if (!profile.current_vehicle_id) {
        throw new ApiError(422, "ONBOARDING_INCOMPLETE", "Save the vehicle before choosing categories.", { missing: ["vehicle"] });
      }
      const vehicle = await trx.selectFrom("vehicles").selectAll().where("id", "=", profile.current_vehicle_id).executeTakeFirstOrThrow();
      const account = await trx.selectFrom("accounts").select("gender").where("id", "=", driverId).executeTakeFirstOrThrow();

      const wanted = [...new Set(dto.category_ids)];
      const cats = await trx.selectFrom("vehicle_categories").selectAll().where("id", "in", wanted).execute();
      for (const id of wanted) {
        const c = cats.find((x) => x.id === id);
        if (!c || !c.active) {
          throw new ApiError(400, "VALIDATION_FAILED", "Unknown or unavailable category.", { issues: [{ path: "category_ids", message: `unavailable: ${id}` }] });
        }
        const [misfit] = await this.eligibility.vehicleFit(vehicle.id, id, trx);
        const why = misfit ?? (c.female_drivers_only && account.gender !== "FEMALE" ? "WOMEN_ONLY" : null);
        if (why) throw new ApiError(403, "CATEGORY_NOT_ELIGIBLE", "You are not eligible for this category.", { category_id: id, reason: why });
      }
      for (const id of wanted) {
        await trx
          .insertInto("driver_category_approvals")
          .values({ driver_id: driverId, category_id: id, vehicle_id: vehicle.id, reason: null, decided_by: null, decided_at: null })
          .onConflict((oc) => oc.columns(["driver_id", "category_id"]).doNothing())
          .execute();
      }
      await trx
        .deleteFrom("driver_category_approvals")
        .where("driver_id", "=", driverId)
        .where("status", "=", "PENDING")
        .where("category_id", "not in", wanted)
        .execute();
      return this.buildStatus(trx, driverId);
    });
  }

  async attachDocument(driverId: string, dto: DocumentAttachDto): Promise<DriverDocumentView> {
    return this.db.transaction().execute(async (trx) => {
      const profile = await this.lockDriver(trx, driverId);
      this.assertEditable(profile.status, ["ONBOARDING", "NEEDS_CHANGES", "APPROVED"]);

      const required = await this.requiredTypes(trx, driverId);
      const type = required.find((t) => t.id === dto.document_type_id);
      if (!type) throw new ApiError(400, "VALIDATION_FAILED", "This document is not required for your categories.", { issues: [{ path: "document_type_id", message: "not required" }] });

      let vehicleId: string | null = null;
      if (type.subject === "VEHICLE") {
        if (!profile.current_vehicle_id || (dto.vehicle_id && dto.vehicle_id !== profile.current_vehicle_id)) {
          throw new ApiError(400, "VALIDATION_FAILED", "Vehicle documents belong to your current vehicle.", { issues: [{ path: "vehicle_id", message: "not your current vehicle" }] });
        }
        vehicleId = profile.current_vehicle_id;
      } else if (dto.vehicle_id) {
        throw new ApiError(400, "VALIDATION_FAILED", "This document is not tied to a vehicle.", { issues: [{ path: "vehicle_id", message: "must be empty" }] });
      }

      const today = await this.today(trx);
      if (type.has_expiry) {
        if (!dto.expires_on || Number.isNaN(Date.parse(dto.expires_on))) {
          throw new ApiError(400, "VALIDATION_FAILED", "An expiry date is required for this document.", { issues: [{ path: "expires_on", message: "required" }] });
        }
        if (dto.expires_on < today) {
          throw new ApiError(400, "VALIDATION_FAILED", "This document has already expired.", { issues: [{ path: "expires_on", message: "in the past" }] });
        }
      } else if (dto.expires_on) {
        throw new ApiError(400, "VALIDATION_FAILED", "This document has no expiry date.", { issues: [{ path: "expires_on", message: "not applicable" }] });
      }

      const upload = await trx
        .selectFrom("uploads")
        .select(["id", "status", "purpose"])
        .where("id", "=", dto.upload_id)
        .where("owner_account_id", "=", driverId)
        .forUpdate()
        .executeTakeFirst();
      if (!upload || upload.purpose !== "DRIVER_DOCUMENT" || upload.status !== "COMPLETED") {
        throw new ApiError(400, "UPLOAD_INVALID", "The upload is missing, not finished, or not a document upload.");
      }
      const used = await trx.selectFrom("driver_documents").select("id").where("upload_id", "=", dto.upload_id).executeTakeFirst();
      if (used) throw new ApiError(400, "UPLOAD_INVALID", "This upload is already attached.");

      // Replacing supersedes the current document of the same kind. Note: replacing an APPROVED
      // document puts the new one in review, and the driver stays ineligible for categories that
      // need it until it is approved (register TBD-4-02: renewal without a gap).
      const supersede = trx
        .updateTable("driver_documents")
        .set({ status: "SUPERSEDED" })
        .where("driver_id", "=", driverId)
        .where("document_type_id", "=", type.id)
        .where("status", "in", ["UPLOADED", "APPROVED", "NEEDS_CHANGES"]);
      await (vehicleId ? supersede.where("vehicle_id", "=", vehicleId) : supersede.where("vehicle_id", "is", null)).execute();

      const doc = await trx
        .insertInto("driver_documents")
        .values({
          driver_id: driverId,
          vehicle_id: vehicleId,
          document_type_id: type.id,
          upload_id: dto.upload_id,
          expires_on: dto.expires_on ?? null,
          review_reason: null,
          reviewed_by: null,
          reviewed_at: null,
        })
        .returning(["id", "document_type_id", "vehicle_id", "status", "review_reason", "expires_on"])
        .executeTakeFirstOrThrow();
      const t = await trx.selectFrom("document_types").select(["code", "names"]).where("id", "=", doc.document_type_id).executeTakeFirstOrThrow();
      return { id: doc.id, document_type_code: t.code, document_type_names: t.names, document_type_id: doc.document_type_id, vehicle_id: doc.vehicle_id, status: doc.status, review_reason: doc.review_reason, expires_on: (doc.expires_on as string | null) ?? null };
    });
  }

  async submit(driverId: string) {
    return this.db.transaction().execute(async (trx) => {
      const profile = await this.lockDriver(trx, driverId);
      this.assertEditable(profile.status);
      const st = await this.buildStatus(trx, driverId);
      const missing: string[] = [];
      if (!st.checklist.profile) missing.push("profile");
      if (!st.checklist.vehicle) missing.push("vehicle");
      if (!st.checklist.categories) missing.push("categories");
      if (!st.checklist.documents_complete) missing.push("documents");
      if (missing.length > 0) throw new ApiError(422, "ONBOARDING_INCOMPLETE", "Complete every step before submitting.", { missing });
      await trx
        .updateTable("driver_profiles")
        .set({ status: "SUBMITTED", status_reason: null, submitted_at: sql`now()` as never })
        .where("account_id", "=", driverId)
        .execute();
      return this.buildStatus(trx, driverId);
    });
  }
}
