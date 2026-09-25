import { ColumnType, Generated } from "kysely";

// Kysely interfaces for the tables Phase 3 touches only (identity + session tables from
// db/migrations/004_identity.sql). Extend this file module-by-module as later phases add
// repositories; do not hand-generate the full 40-table schema ahead of need.

type Timestamp = ColumnType<Date, Date | string, Date | string>;

export interface AccountsTable {
  id: Generated<string>;
  phone_e164: string;
  first_name: string | null;
  last_name: string | null;
  gender: "FEMALE" | "MALE" | null;
  gender_confirmed_at: Timestamp | null;
  gender_confirmed_by: string | null;
  email: string | null;
  language: "ar" | "en" | "fr";
  preferred_currency: string | null;
  status: Generated<"ACTIVE" | "DELETED">;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface RiderProfilesTable {
  account_id: string;
  rating_avg_bp: number | null;
  rating_count: Generated<number>;
  created_at: Generated<Timestamp>;
}

export interface OtpChallengesTable {
  id: Generated<string>;
  phone_e164: string;
  code_hash: string;
  provider_ref: string | null;
  attempts: Generated<number>;
  expires_at: Timestamp;
  consumed_at: Timestamp | null;
  created_at: Generated<Timestamp>;
  app: "RIDER" | "DRIVER";
}

export interface SessionsTable {
  id: Generated<string>;
  account_id: string;
  app: "RIDER" | "DRIVER";
  refresh_token_hash: string;
  device_label: string | null;
  created_at: Generated<Timestamp>;
  last_used_at: Timestamp | null;
  expires_at: Timestamp;
  revoked_at: Timestamp | null;
  revoke_reason: string | null;
}

export interface LegalDocumentVersionsTable {
  id: Generated<string>;
  audience: ("RIDER" | "DRIVER")[];
  status: "DRAFT" | "PUBLISHED" | "RETIRED";
}

export interface LegalAcceptancesTable {
  account_id: string;
  version_id: string;
  app: "RIDER" | "DRIVER";
  accepted_at: Generated<Timestamp>;
}

export interface AccountBlocksTable {
  id: Generated<string>;
  account_id: string;
  applies_to: ("RIDER" | "DRIVER")[];
  effective_at: Timestamp | null;
  lifted_at: Timestamp | null;
}

export interface Database {
  legal_document_versions: LegalDocumentVersionsTable;
  legal_acceptances: LegalAcceptancesTable;
  account_blocks: AccountBlocksTable;
  accounts: AccountsTable;
  rider_profiles: RiderProfilesTable;
  otp_challenges: OtpChallengesTable;
  sessions: SessionsTable;
}
