import { Inject, Injectable } from "@nestjs/common";
import { Kysely, Transaction, sql } from "kysely";
import { ApiError } from "../../common/api-error";
import { DB } from "../../db/db.module";
import { Database } from "../../db/schema-types";
import { AppKind } from "./jwt.service";

type Db = Kysely<Database> | Transaction<Database>;
type Lang = "ar" | "en" | "fr";

// Legal text is CMS data (D-22): nothing here invents wording. When no document is published for
// an audience, nothing is required.
@Injectable()
export class LegalService {
  constructor(@Inject(DB) private readonly db: Kysely<Database>) {}

  /** Latest PUBLISHED version of each document type addressed to the app. */
  async currentVersions(db: Db, app: AppKind) {
    return db
      .selectFrom("legal_document_versions as v")
      .select(["v.id", "v.doc_type", "v.version_no", "v.requires_reacceptance", "v.published_at"])
      .where("v.status", "=", "PUBLISHED")
      .where(sql<boolean>`${app}::app_kind = any(v.audience)`)
      .where(
        sql<boolean>`v.version_no = (select max(x.version_no) from legal_document_versions x
          where x.doc_type = v.doc_type and x.status = 'PUBLISHED' and ${app}::app_kind = any(x.audience))`,
      )
      .execute();
  }

  /** accountId null = sign-up (no account yet): the language comes from the caller. */
  async listCurrent(accountId: string | null, app: AppKind, language?: Lang) {
    const acct = accountId ? await this.db.selectFrom("accounts").select("language").where("id", "=", accountId).executeTakeFirst() : undefined;
    const preferred: Lang = acct?.language ?? language ?? "en";
    const versions = await this.currentVersions(this.db, app);
    const out = [];
    for (const v of versions) {
      const texts = await this.db.selectFrom("legal_document_texts").selectAll().where("version_id", "=", v.id).execute();
      const t = texts.find((x) => x.language === preferred) ?? texts.find((x) => x.language === "en") ?? texts[0];
      if (!t) continue; // a published version with no text cannot be shown, so it is not offered
      out.push({
        id: v.id,
        doc_type: v.doc_type,
        version_no: v.version_no,
        requires_reacceptance: v.requires_reacceptance,
        language: t.language,
        title: t.title,
        body_markdown: t.body_markdown,
        change_summary: t.change_summary,
        published_at: v.published_at ? new Date(v.published_at as unknown as string).toISOString() : null,
      });
    }
    return out;
  }

  async accept(accountId: string, app: AppKind, versionId: string): Promise<void> {
    const found = await this.db
      .selectFrom("legal_document_versions")
      .select("id")
      .where("id", "=", versionId)
      .where("status", "=", "PUBLISHED")
      .where(sql<boolean>`${app}::app_kind = any(audience)`)
      .executeTakeFirst();
    if (!found) throw new ApiError(404, "NOT_FOUND", "Unknown legal document version.");
    await this.db
      .insertInto("legal_acceptances")
      .values({ account_id: accountId, version_id: versionId, app })
      .onConflict((oc) => oc.columns(["account_id", "version_id"]).doNothing())
      .execute();
  }

  /** Versions of the current set the account has not accepted (empty = complete). */
  async missingAcceptances(db: Db, accountId: string, app: AppKind): Promise<string[]> {
    const current = await this.currentVersions(db, app);
    if (current.length === 0) return [];
    const accepted = await db
      .selectFrom("legal_acceptances")
      .select("version_id")
      .where("account_id", "=", accountId)
      .where("version_id", "in", current.map((c) => c.id))
      .execute();
    const have = new Set(accepted.map((a) => a.version_id));
    return current.filter((c) => !have.has(c.id)).map((c) => c.id);
  }

  /** Sign-up: the supplied ids must be published for the app and cover the whole current set. */
  async assertAcceptedSetComplete(db: Db, app: AppKind, versionIds: string[]): Promise<void> {
    const current = await this.currentVersions(db, app);
    const currentIds = new Set(current.map((c) => c.id));
    const unknown = versionIds.filter((id) => !currentIds.has(id));
    if (unknown.length > 0) {
      throw new ApiError(400, "VALIDATION_FAILED", "Unknown or superseded legal document version.", { unknown_version_ids: unknown });
    }
    const supplied = new Set(versionIds);
    const missing = current.filter((c) => !supplied.has(c.id)).map((c) => c.id);
    if (missing.length > 0) {
      throw new ApiError(400, "TERMS_ACCEPTANCE_REQUIRED", "The current terms must be accepted to continue.", { missing_version_ids: missing });
    }
  }
}
