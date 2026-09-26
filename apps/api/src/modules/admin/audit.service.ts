import { Inject, Injectable } from "@nestjs/common";
import { Kysely, Transaction, sql } from "kysely";
import { DB } from "../../db/db.module";
import { Database } from "../../db/schema-types";
import { AdminContext } from "./admin.guard";

type Db = Kysely<Database> | Transaction<Database>;

export interface AuditEntry {
  action: string;
  targetType: string;
  targetId: string;
  reason?: string | null;
  before?: unknown;
  after?: unknown;
}

// admin_audit_log is append-only (trigger). Mutations call record() with the SAME transaction
// as the change, so an action and its audit row commit or roll back together (D-33, §3.3).
@Injectable()
export class AuditService {
  constructor(@Inject(DB) private readonly db: Kysely<Database>) {}

  async record(db: Db, admin: AdminContext, e: AuditEntry): Promise<void> {
    await db
      .insertInto("admin_audit_log")
      .values({
        admin_id: admin.id,
        action: e.action,
        target_type: e.targetType,
        target_id: e.targetId,
        reason: e.reason ?? null,
        before_state: e.before === undefined ? null : JSON.stringify(e.before),
        after_state: e.after === undefined ? null : JSON.stringify(e.after),
        ip: admin.ip,
        correlation_id: admin.correlationId || null,
        actor_roles: sql`${admin.roles}::text[]` as never,
      })
      .execute();
  }

  async list(f: { adminId?: string; targetType?: string; targetId?: string; action?: string; from?: string; to?: string; cursor?: string; limit: number }) {
    let q = this.db
      .selectFrom("admin_audit_log as l")
      .leftJoin("admin_users as u", "u.id", "l.admin_id")
      .select(["l.id", "l.admin_id", "u.full_name as admin_name", "l.action", "l.target_type", "l.target_id", "l.reason", "l.before_state", "l.after_state", "l.ip", "l.correlation_id", "l.created_at"])
      .orderBy("l.id", "desc")
      .limit(f.limit + 1);
    if (f.adminId) q = q.where("l.admin_id", "=", f.adminId);
    if (f.targetType) q = q.where("l.target_type", "=", f.targetType);
    if (f.targetId) q = q.where("l.target_id", "=", f.targetId);
    if (f.action) q = q.where("l.action", "=", f.action);
    if (f.from) q = q.where(sql<boolean>`l.created_at >= ${f.from}::timestamptz`);
    if (f.to) q = q.where(sql<boolean>`l.created_at <= ${f.to}::timestamptz`);
    if (f.cursor) q = q.where("l.id", "<", Number(f.cursor));
    const rows = await q.execute();
    const page = rows.slice(0, f.limit);
    return {
      items: page.map((r) => ({
        id: Number(r.id),
        admin_id: r.admin_id,
        ...(r.admin_name ? { admin_name: r.admin_name } : {}),
        action: r.action,
        target_type: r.target_type,
        target_id: r.target_id,
        reason: r.reason,
        before_state: (r.before_state as object | null) ?? null,
        after_state: (r.after_state as object | null) ?? null,
        ip: r.ip,
        correlation_id: r.correlation_id,
        created_at: new Date(r.created_at as unknown as string).toISOString(),
      })),
      next_cursor: rows.length > f.limit ? String(page[page.length - 1]!.id) : null,
    };
  }
}
