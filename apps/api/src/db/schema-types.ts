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
  previous_refresh_token_hash: string | null;
}

export interface LegalDocumentVersionsTable {
  id: Generated<string>;
  doc_type: "TERMS" | "PRIVACY" | "DRIVER_AGREEMENT" | "CANCELLATION" | "OTHER";
  audience: ("RIDER" | "DRIVER")[];
  version_no: number;
  requires_reacceptance: Generated<boolean>;
  status: "DRAFT" | "PUBLISHED" | "RETIRED";
  published_at: Timestamp | null;
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
  reason: string;
  created_by: string;
  created_at: Generated<Timestamp>;
  effective_at: Timestamp | null;
  lifted_at: Timestamp | null;
  lifted_by: string | null;
  lift_reason: string | null;
}

export interface LegalDocumentTextsTable {
  version_id: string;
  language: "ar" | "en" | "fr";
  title: string;
  body_markdown: string;
  change_summary: string | null;
}

export interface PushDevicesTable {
  id: Generated<string>;
  account_id: string;
  app: "RIDER" | "DRIVER";
  platform: "android" | "ios";
  token: string;
  updated_at: Generated<Timestamp>;
}

export type DriverStatus = "ONBOARDING" | "SUBMITTED" | "NEEDS_CHANGES" | "APPROVED" | "REJECTED" | "SUSPENDED";
export type ApprovalStatus = "PENDING" | "APPROVED" | "REJECTED" | "PAUSED_BY_DRIVER";
export type DocumentStatus = "UPLOADED" | "APPROVED" | "NEEDS_CHANGES" | "REJECTED" | "EXPIRED" | "SUPERSEDED";
export type VehicleBaseType = "CAR" | "MOTORCYCLE" | "TUKTUK";

export interface DriverProfilesTable {
  account_id: string;
  status: Generated<DriverStatus>;
  status_reason: string | null;
  submitted_at: Timestamp | null;
  decided_at: Timestamp | null;
  decided_by: string | null;
  current_vehicle_id: string | null;
  rating_avg_bp: number | null;
  rating_count: Generated<number>;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface VehiclesTable {
  id: Generated<string>;
  driver_id: string;
  base_type: VehicleBaseType;
  make: string;
  model: string;
  year: number | null;
  color: string;
  plate: string;
  seats: number;
  active: Generated<boolean>;
  created_at: Generated<Timestamp>;
}

export interface DriverCategoryApprovalsTable {
  driver_id: string;
  category_id: string;
  vehicle_id: string;
  status: Generated<ApprovalStatus>;
  reason: string | null;
  decided_by: string | null;
  decided_at: Timestamp | null;
}

export interface UploadsTable {
  id: Generated<string>;
  owner_account_id: string;
  purpose: "DRIVER_DOCUMENT" | "PROFILE_PHOTO" | "VEHICLE_CHECK" | "CASE_EVIDENCE";
  object_key: string;
  content_type: string;
  max_bytes: number;
  size_bytes: number | null;
  sha256: string | null;
  status: Generated<"AUTHORIZED" | "COMPLETED" | "QUARANTINED" | "REJECTED" | "EXPIRED">;
  expires_at: Timestamp;
  completed_at: Timestamp | null;
  created_at: Generated<Timestamp>;
  staging_object_key: string | null;
}

export interface DriverDocumentsTable {
  id: Generated<string>;
  driver_id: string;
  vehicle_id: string | null;
  document_type_id: string;
  upload_id: string;
  expires_on: string | Date | null;
  status: Generated<DocumentStatus>;
  review_reason: string | null;
  reviewed_by: string | null;
  reviewed_at: Timestamp | null;
  created_at: Generated<Timestamp>;
}

export interface DocumentTypesTable {
  id: Generated<string>;
  code: string;
  names: unknown;
  subject: "DRIVER" | "VEHICLE";
  has_expiry: Generated<boolean>;
  allow_gallery: Generated<boolean>;
  active: Generated<boolean>;
}

export interface VehicleCategoriesTable {
  id: Generated<string>;
  code: string;
  names: unknown;
  descriptions: unknown | null;
  base_type: VehicleBaseType;
  seats: number;
  female_drivers_only: Generated<boolean>;
  female_riders_only: Generated<boolean>;
  vehicle_rules: Generated<unknown>;
  icon: string;
  color: string | null;
  sort_order: Generated<number>;
  active: Generated<boolean>;
}

export interface CategoryDocumentRequirementsTable {
  category_id: string;
  document_type_id: string;
}

export interface VehicleChecksTable {
  id: Generated<string>;
  vehicle_id: string;
  due_on: string | Date;
  status: Generated<"DUE" | "SUBMITTED" | "APPROVED" | "NEEDS_CHANGES">;
}

export interface RidesTable {
  id: Generated<string>;
  rider_id: string;
  status: Generated<string>;
}

export interface RideAssignmentsTable {
  id: Generated<string>;
  ride_id: string;
  driver_id: string;
  ended_at: Timestamp | null;
}

export interface AdminUsersTable {
  id: Generated<string>;
  email: string;
  full_name: string;
  password_hash: string;
  totp_secret_enc: Buffer | null;
  mfa_enrolled_at: Timestamp | null;
  status: Generated<"ACTIVE" | "DEACTIVATED">;
  created_at: Generated<Timestamp>;
}

export interface AdminRecoveryCodesTable {
  id: Generated<string>;
  admin_id: string;
  code_hash: string;
  used_at: Timestamp | null;
}

export interface AdminRolesTable {
  code: string;
  permissions: string[];
}

export interface AdminUserRolesTable {
  admin_id: string;
  role_code: string;
  granted_by: string | null;
  granted_at: Generated<Timestamp>;
}

export interface AdminSessionsTable {
  id: Generated<string>;
  admin_id: string;
  token_hash: string;
  mfa_verified_at: Timestamp | null;
  ip: string | null;
  created_at: Generated<Timestamp>;
  expires_at: Timestamp;
  revoked_at: Timestamp | null;
}

export interface AdminAuditLogTable {
  id: Generated<number>;
  admin_id: string;
  action: string;
  target_type: string;
  target_id: string;
  reason: string | null;
  before_state: unknown | null;
  after_state: unknown | null;
  ip: string | null;
  correlation_id: string | null;
  created_at: Generated<Timestamp>;
  actor_roles: string[] | null;
}

export interface CurrenciesTable {
  code: string;
  minor_exponent: number;
}

export interface Database {
  currencies: CurrenciesTable;
  legal_document_versions: LegalDocumentVersionsTable;
  legal_acceptances: LegalAcceptancesTable;
  account_blocks: AccountBlocksTable;
  accounts: AccountsTable;
  rider_profiles: RiderProfilesTable;
  otp_challenges: OtpChallengesTable;
  sessions: SessionsTable;
  legal_document_texts: LegalDocumentTextsTable;
  push_devices: PushDevicesTable;
  driver_profiles: DriverProfilesTable;
  vehicles: VehiclesTable;
  driver_category_approvals: DriverCategoryApprovalsTable;
  uploads: UploadsTable;
  driver_documents: DriverDocumentsTable;
  document_types: DocumentTypesTable;
  vehicle_categories: VehicleCategoriesTable;
  category_document_requirements: CategoryDocumentRequirementsTable;
  vehicle_checks: VehicleChecksTable;
  rides: RidesTable;
  ride_assignments: RideAssignmentsTable;
  admin_users: AdminUsersTable;
  admin_recovery_codes: AdminRecoveryCodesTable;
  admin_roles: AdminRolesTable;
  admin_user_roles: AdminUserRolesTable;
  admin_sessions: AdminSessionsTable;
  admin_audit_log: AdminAuditLogTable;
}
