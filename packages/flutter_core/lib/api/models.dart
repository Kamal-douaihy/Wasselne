/// Response models for the Phase 4 identity and driver-onboarding endpoints
/// (docs/phase-2/openapi.yaml). Field names follow the contract.
library;

import 'dart:ui' show Locale;

/// Localized CMS text {"ar","en","fr"}; falls back to English, then to any value.
class LocalizedText {
  const LocalizedText(this.values);
  final Map<String, String> values;

  factory LocalizedText.fromJson(Object? json) => LocalizedText({
    if (json is Map<String, dynamic>)
      for (final e in json.entries)
        if (e.value is String) e.key: e.value as String,
  });

  String of(Locale locale) =>
      values[locale.languageCode] ??
      values['en'] ??
      (values.values.isNotEmpty ? values.values.first : '');
}

class Profile {
  const Profile({
    required this.id,
    required this.phoneE164,
    required this.language,
    required this.status,
    this.firstName,
    this.lastName,
    this.gender,
    this.genderConfirmed = false,
    this.email,
  });

  final String id;
  final String phoneE164;
  final String language;
  final String status;
  final String? firstName;
  final String? lastName;
  final String? gender;
  final bool genderConfirmed;
  final String? email;

  String get displayName =>
      [firstName, lastName].whereType<String>().join(' ').trim();

  factory Profile.fromJson(Map<String, dynamic> json) => Profile(
    id: json['id'] as String,
    phoneE164: json['phone_e164'] as String,
    language: json['language'] as String,
    status: json['status'] as String,
    firstName: json['first_name'] as String?,
    lastName: json['last_name'] as String?,
    gender: json['gender'] as String?,
    genderConfirmed: json['gender_confirmed'] as bool? ?? false,
    email: json['email'] as String?,
  );
}

class LegalDocument {
  const LegalDocument({
    required this.id,
    required this.docType,
    required this.title,
    required this.bodyMarkdown,
  });
  final String id;
  final String docType;
  final String title;
  final String bodyMarkdown;

  factory LegalDocument.fromJson(Map<String, dynamic> json) => LegalDocument(
    id: json['id'] as String,
    docType: json['doc_type'] as String,
    title: json['title'] as String,
    bodyMarkdown: json['body_markdown'] as String,
  );
}

class RequiredDocument {
  const RequiredDocument({
    required this.documentTypeId,
    required this.code,
    required this.names,
    required this.subject,
    required this.hasExpiry,
    this.allowGallery = true,
  });
  final String documentTypeId;
  final String code;
  final LocalizedText names;
  final String subject; // DRIVER | VEHICLE
  final bool hasExpiry;
  final bool allowGallery;

  factory RequiredDocument.fromJson(Map<String, dynamic> json) =>
      RequiredDocument(
        documentTypeId: json['document_type_id'] as String,
        code: json['code'] as String,
        names: LocalizedText.fromJson(json['names']),
        subject: json['subject'] as String,
        hasExpiry: json['has_expiry'] as bool,
        allowGallery: json['allow_gallery'] as bool? ?? true,
      );
}

class CategoryOption {
  const CategoryOption({
    required this.id,
    required this.code,
    required this.names,
    required this.baseType,
    required this.seats,
    required this.femaleDriversOnly,
    required this.requiredDocuments,
    this.minVehicleYear,
  });
  final String id;
  final String code;
  final LocalizedText names;
  final String baseType;
  final int seats;
  final bool femaleDriversOnly;
  final int? minVehicleYear;
  final List<RequiredDocument> requiredDocuments;

  factory CategoryOption.fromJson(Map<String, dynamic> json) => CategoryOption(
    id: json['id'] as String,
    code: json['code'] as String,
    names: LocalizedText.fromJson(json['names']),
    baseType: json['base_type'] as String,
    seats: json['seats'] as int,
    femaleDriversOnly: json['female_drivers_only'] as bool,
    minVehicleYear: json['min_vehicle_year'] as int?,
    requiredDocuments: [
      for (final d in json['required_documents'] as List<dynamic>)
        RequiredDocument.fromJson(d as Map<String, dynamic>),
    ],
  );
}

class DriverDocument {
  const DriverDocument({
    required this.id,
    required this.documentTypeId,
    required this.status,
    this.vehicleId,
    this.reviewReason,
    this.expiresOn,
  });
  final String id;
  final String documentTypeId;
  final String
  status; // UPLOADED | APPROVED | NEEDS_CHANGES | REJECTED | EXPIRED
  final String? vehicleId;
  final String? reviewReason;
  final String? expiresOn;

  factory DriverDocument.fromJson(Map<String, dynamic> json) => DriverDocument(
    id: json['id'] as String,
    documentTypeId: json['document_type_id'] as String,
    status: json['status'] as String,
    vehicleId: json['vehicle_id'] as String?,
    reviewReason: json['review_reason'] as String?,
    expiresOn: json['expires_on'] as String?,
  );
}

class OnboardingChecklist {
  const OnboardingChecklist({
    required this.profile,
    required this.vehicle,
    required this.categories,
    required this.documentsComplete,
    required this.documentsTotal,
    required this.documentsDone,
  });
  final bool profile;
  final bool vehicle;
  final bool categories;
  final bool documentsComplete;
  final int documentsTotal;
  final int documentsDone;

  bool get complete => profile && vehicle && categories && documentsComplete;

  factory OnboardingChecklist.fromJson(Map<String, dynamic> json) =>
      OnboardingChecklist(
        profile: json['profile'] as bool? ?? false,
        vehicle: json['vehicle'] as bool? ?? false,
        categories: json['categories'] as bool? ?? false,
        documentsComplete: json['documents_complete'] as bool? ?? false,
        documentsTotal: json['documents_total'] as int? ?? 0,
        documentsDone: json['documents_done'] as int? ?? 0,
      );
}

class AppliedCategory {
  const AppliedCategory({required this.categoryId, required this.status});
  final String categoryId;
  final String status; // PENDING | APPROVED | REJECTED | PAUSED_BY_DRIVER
}

class DriverOnboardingStatus {
  const DriverOnboardingStatus({
    required this.status,
    required this.checklist,
    required this.documents,
    this.categories = const [],
    this.statusReason,
  });
  final List<AppliedCategory> categories;
  final String status; // ONBOARDING | SUBMITTED | NEEDS_CHANGES | APPROVED | REJECTED | SUSPENDED
  final String? statusReason;
  final OnboardingChecklist checklist;
  final List<DriverDocument> documents;

  bool get editable => status == 'ONBOARDING' || status == 'NEEDS_CHANGES';

  factory DriverOnboardingStatus.fromJson(Map<String, dynamic> json) =>
      DriverOnboardingStatus(
        status: json['status'] as String,
        statusReason: json['status_reason'] as String?,
        checklist: OnboardingChecklist.fromJson(
          json['checklist'] as Map<String, dynamic>,
        ),
        categories: [
          for (final c in (json['categories'] as List<dynamic>? ?? const []))
            AppliedCategory(
              categoryId: (c as Map<String, dynamic>)['category_id'] as String,
              status: c['status'] as String,
            ),
        ],
        documents: [
          for (final d in (json['documents'] as List<dynamic>? ?? const []))
            DriverDocument.fromJson(d as Map<String, dynamic>),
        ],
      );
}

class UploadGrant {
  const UploadGrant({
    required this.uploadId,
    required this.putUrl,
    required this.requiredHeaders,
  });
  final String uploadId;
  final String putUrl;
  final Map<String, String> requiredHeaders;

  factory UploadGrant.fromJson(Map<String, dynamic> json) => UploadGrant(
    uploadId: json['upload_id'] as String,
    putUrl: json['put_url'] as String,
    requiredHeaders: {
      for (final e
          in (json['required_headers'] as Map<String, dynamic>? ?? const {})
              .entries)
        e.key: e.value as String,
    },
  );
}
