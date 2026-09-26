import { Inject, Injectable } from "@nestjs/common";
import { Kysely, Transaction, sql } from "kysely";
import { ApiError } from "../../common/api-error";
import { PageQuery, decodeCursor, encodeCursor } from "../../common/cursor";
import { ENV } from "../../config/env.module";
import { Env } from "../../config/env";
import { DB } from "../../db/db.module";
import { Database } from "../../db/schema-types";
import { TODAY_BEIRUT } from "../drivers/document-expiry.service";
import { EligibilityService } from "../drivers/eligibility.service";
import { OnboardingService } from "../drivers/onboarding.service";
import { ObjectStorage } from "../storage/object-storage";
import { AdminContext } from "./admin.guard";
import { AuditService } from "./audit.service";

type Trx = Transaction<Database>;
const QUEUE_TO_DRIVER = { PENDING: "SUBMITTED", APPROVED: "APPROVED", REJECTED: "REJECTED", NEEDS_CHANGES: "NEEDS_CHANGES" } as const;
const DRIVER_TO_QUEUE: Record<string, "PENDING" | "APPROVED" | "REJECTED" | "NEEDS_CHANGES"> = {
  SUBMITTED: "PENDING", APPROVED: "APPROVED", REJECTED: "REJECTED", NEEDS_CHANGES: "NEEDS_CHANGES",
};

export interface QueueQuery extends PageQuery {
  status?: keyof typeof QUEUE_TO_DRIVER;
  category_id?: string;
  zone_id?: string;
}

@Injectable()
export class ApprovalsService {
  constructor(
    @Inject(DB) private readonly db: Kysely<Database>,
    @Inject(ENV) private readonly env: Env,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(EligibilityService) private readonly eligibility: EligibilityService,
    @Inject(OnboardingService) private readonly onboarding: OnboardingService,
    @Inject(ObjectStorage) private readonly storage: ObjectStorage,
  ) {}

  async queue(q: QueueQuery) {
    if (q.zone_id) {
      // Drivers are not tied to a service zone until presence/locations exist (Phase 5).
      throw new ApiError(400, "VALIDATION_FAILED", "Filtering by zone is not available yet.", { issues: [{ path: "zone_id", message: "not available until Phase 5" }] });
    }
    const cur = decodeCursor<{ t: string; id: string }>(q.cursor, ["t", "id"]);
    let query = this.db
      .selectFrom("driver_profiles as dp")
      .innerJoin("accounts as a", "a.id", "dp.account_id")
      .select(["dp.account_id", "dp.status", "dp.submitted_at", "a.first_name", "a.last_name", sql<string>`dp.submitted_at::text`.as("cursor_t")])
      .where("dp.status", "=", QUEUE_TO_DRIVER[q.status ?? "PENDING"])
      .where("dp.submitted_at", "is not", null)
      .orderBy("dp.submitted_at", "asc")
      .orderBy("dp.account_id", "asc")
      .limit(q.limit + 1);
    if (q.category_id) {
      query = query.where(
        sql<boolean>`exists (select 1 from driver_category_approvals c where c.driver_id = dp.account_id and c.category_id = ${q.category_id}::uuid)`,
      );
    }
    if (q.q) {
      const like = `%${q.q.replace(/[%_\\]/g, "\\$&")}%`;
      query = query.where((eb) => eb.or([eb("a.first_name", "ilike", like), eb("a.last_name", "ilike", like), eb("a.phone_e164", "ilike", like)]));
    }
    if (cur) query = query.where(sql<boolean>`(dp.submitted_at, dp.account_id) > (${cur.t}::timestamptz, ${cur.id}::uuid)`);
    const rows = await query.execute();
    const page = rows.slice(0, q.limit);
    const items = [];
    for (const r of page) {
      const required = await this.onboarding.requiredTypes(this.db, r.account_id);
      const docs = await this.onboarding.listDocuments(this.db, r.account_id);
      const cats = await sql<{ code: string }>`
        select c.code from driver_category_approvals a join vehicle_categories c on c.id = a.category_id
         where a.driver_id = ${r.account_id}::uuid order by c.code`.execute(this.db);
      items.push({
        driver_id: r.account_id,
        driver_name: [r.first_name, r.last_name].filter(Boolean).join(" "),
        submitted_at: new Date(r.submitted_at as unknown as string).toISOString(),
        categories_requested: cats.rows.map((c) => c.code),
        documents_total: required.length,
        documents_ready: docs.filter((d) => d.status === "APPROVED").length,
        status: DRIVER_TO_QUEUE[r.status]!,
      });
    }
    const last = page[page.length - 1];
    return {
      items,
      next_cursor: rows.length > q.limit && last ? encodeCursor({ t: last.cursor_t, id: last.account_id }) : null,
    };
  }

  private async lockDriver(trx: Trx, id: string) {
    const p = await trx.selectFrom("driver_profiles").selectAll().where("account_id", "=", id).forUpdate().executeTakeFirst();
    if (!p) throw new ApiError(404, "NOT_FOUND", "Unknown driver.");
    return p;
  }

  /** Sensitive view: the audit row is written first, in the same transaction as the URL is minted. */
  async documentDownload(admin: AdminContext, driverId: string, documentId: string) {
    return this.db.transaction().execute(async (trx) => {
      const doc = await trx
        .selectFrom("driver_documents as d")
        .innerJoin("uploads as u", "u.id", "d.upload_id")
        .select(["d.id", "d.document_type_id", "u.object_key", "u.status as upload_status"])
        .where("d.id", "=", documentId)
        .where("d.driver_id", "=", driverId)
        .executeTakeFirst();
      if (!doc || doc.upload_status !== "COMPLETED") throw new ApiError(404, "NOT_FOUND", "Unknown document.");
      await this.audit.record(trx, admin, { action: "driver_document.view", targetType: "driver_document", targetId: documentId, after: { driver_id: driverId, document_type_id: doc.document_type_id } });
      const url = await this.storage.presignGet(doc.object_key, this.env.DOWNLOAD_URL_TTL_S);
      return { url, expires_at: new Date(Date.now() + this.env.DOWNLOAD_URL_TTL_S * 1000).toISOString() };
    });
  }

  async decideDocument(admin: AdminContext, driverId: string, documentId: string, decision: "approve" | "reject" | "request-changes", reason: string) {
    return this.db.transaction().execute(async (trx) => {
      const driver = await this.lockDriver(trx, driverId);
      const doc = await trx.selectFrom("driver_documents").selectAll().where("id", "=", documentId).where("driver_id", "=", driverId).forUpdate().executeTakeFirst();
      if (!doc) throw new ApiError(404, "NOT_FOUND", "Unknown document.");
      const allowedFrom = decision === "approve" ? ["UPLOADED"] : ["UPLOADED", "APPROVED"];
      if (!allowedFrom.includes(doc.status)) throw new ApiError(409, "INVALID_STATE", `A ${doc.status} document cannot be ${decision === "approve" ? "approved" : "sent back"}.`, { status: doc.status });
      if (decision === "approve" && doc.expires_on) {
        const today = (await sql<{ d: string }>`select ${TODAY_BEIRUT} as d`.execute(trx)).rows[0]!.d;
        if ((doc.expires_on as string) < today) throw new ApiError(409, "INVALID_STATE", "This document has expired.");
      }
      const next = decision === "approve" ? "APPROVED" : decision === "reject" ? "REJECTED" : "NEEDS_CHANGES";
      await trx
        .updateTable("driver_documents")
        .set({ status: next, review_reason: reason, reviewed_by: admin.id, reviewed_at: sql`now()` as never })
        .where("id", "=", documentId)
        .execute();
      // Sending a document back while the application is under review returns the whole
      // application to the driver; an already-approved driver simply loses eligibility for the
      // categories that need the document (the eligibility rule reads document status directly).
      if (next !== "APPROVED" && driver.status === "SUBMITTED") {
        await trx.updateTable("driver_profiles").set({ status: "NEEDS_CHANGES", status_reason: reason }).where("account_id", "=", driverId).execute();
      }
      await this.audit.record(trx, admin, {
        action: `driver_document.${decision === "request-changes" ? "request_changes" : decision}`,
        targetType: "driver_document",
        targetId: documentId,
        reason,
        before: { status: doc.status, driver_status: driver.status },
        after: { status: next },
      });
      const out = (await this.onboarding.listDocuments(trx, driverId)).find((d) => d.id === documentId);
      return out ?? { id: documentId, document_type_code: "", document_type_names: {}, document_type_id: doc.document_type_id, vehicle_id: doc.vehicle_id, status: next, review_reason: reason, expires_on: (doc.expires_on as string | null) ?? null };
    });
  }

  async approveDriver(admin: AdminContext, driverId: string, reason: string): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const p = await this.lockDriver(trx, driverId);
      if (p.status !== "SUBMITTED") throw new ApiError(409, "INVALID_STATE", `Only a submitted application can be approved (status is ${p.status}).`, { status: p.status });
      await trx
        .updateTable("driver_profiles")
        .set({ status: "APPROVED", status_reason: null, decided_at: sql`now()` as never, decided_by: admin.id })
        .where("account_id", "=", driverId)
        .execute();

      // A category is approved only if the eligibility rule passes for it with the driver
      // approved: documents approved and unexpired, gender confirmed for women-only, and so on.
      const pending = await trx.selectFrom("driver_category_approvals").select("category_id").where("driver_id", "=", driverId).where("status", "=", "PENDING").execute();
      const approved: string[] = [];
      const blocked: Record<string, string[]> = {};
      for (const c of pending) {
        const reasons = await this.eligibility.reasons(driverId, c.category_id, trx);
        // The row is still PENDING here, which the rule reports as CATEGORY_NOT_APPROVED; ignore that one.
        const other = reasons.filter((r) => r !== "CATEGORY_NOT_APPROVED");
        if (other.length === 0) approved.push(c.category_id);
        else blocked[c.category_id] = other;
      }
      if (approved.length === 0) {
        throw new ApiError(409, "INVALID_STATE", "No requested category meets its requirements yet.", { blocking: blocked });
      }
      await trx
        .updateTable("driver_category_approvals")
        .set({ status: "APPROVED", reason, decided_by: admin.id, decided_at: sql`now()` as never })
        .where("driver_id", "=", driverId)
        .where("category_id", "in", approved)
        .execute();
      await this.audit.record(trx, admin, {
        action: "driver.approve",
        targetType: "driver",
        targetId: driverId,
        reason,
        before: { status: p.status },
        after: { status: "APPROVED", categories_approved: approved, categories_pending: blocked },
      });
    });
  }

  async rejectDriver(admin: AdminContext, driverId: string, reason: string): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const p = await this.lockDriver(trx, driverId);
      if (!["SUBMITTED", "NEEDS_CHANGES"].includes(p.status)) throw new ApiError(409, "INVALID_STATE", `This application cannot be rejected (status is ${p.status}).`, { status: p.status });
      await trx
        .updateTable("driver_profiles")
        .set({ status: "REJECTED", status_reason: reason, decided_at: sql`now()` as never, decided_by: admin.id })
        .where("account_id", "=", driverId)
        .execute();
      await trx
        .updateTable("driver_category_approvals")
        .set({ status: "REJECTED", reason, decided_by: admin.id, decided_at: sql`now()` as never })
        .where("driver_id", "=", driverId)
        .where("status", "=", "PENDING")
        .execute();
      await this.audit.record(trx, admin, { action: "driver.reject", targetType: "driver", targetId: driverId, reason, before: { status: p.status }, after: { status: "REJECTED" } });
    });
  }
}
