import 'package:dio/dio.dart';

import 'api_config.dart';

class HealthReport {
  const HealthReport({
    required this.status,
    required this.database,
    required this.redis,
  });

  final String status;
  final String database;
  final String redis;

  factory HealthReport.fromJson(Map<String, dynamic> json) {
    final checks = json['checks'] as Map<String, dynamic>;
    return HealthReport(
      status: json['status'] as String,
      database: checks['database'] as String,
      redis: checks['redis'] as String,
    );
  }
}

class OtpChallenge {
  const OtpChallenge({
    required this.challengeId,
    required this.expiresAt,
    required this.resendAfter,
  });

  final String challengeId;
  final DateTime expiresAt;
  final DateTime resendAfter;

  factory OtpChallenge.fromJson(Map<String, dynamic> json) => OtpChallenge(
    challengeId: json['challenge_id'] as String,
    expiresAt: DateTime.parse(json['expires_at'] as String),
    resendAfter: DateTime.parse(json['resend_after'] as String),
  );
}

class SessionTokens {
  const SessionTokens({
    required this.accessToken,
    required this.refreshToken,
    required this.expiresAt,
  });

  final String accessToken;
  final String refreshToken;
  final DateTime expiresAt;

  factory SessionTokens.fromJson(Map<String, dynamic> json) => SessionTokens(
    accessToken: json['access_token'] as String,
    refreshToken: json['refresh_token'] as String,
    expiresAt: DateTime.parse(json['expires_at'] as String),
  );
}

/// SESSION for a returning account; NEEDS_PROFILE for a new number (then call completeProfile).
class OtpVerifyResult {
  const OtpVerifyResult({
    required this.status,
    this.session,
    this.needsProfileToken,
    this.accountId,
  });

  final String status;
  final SessionTokens? session;
  final String? needsProfileToken;
  final String? accountId;

  bool get needsProfile => status == 'NEEDS_PROFILE';

  factory OtpVerifyResult.fromJson(Map<String, dynamic> json) =>
      OtpVerifyResult(
        status: json['status'] as String,
        session: json['session'] == null
            ? null
            : SessionTokens.fromJson(json['session'] as Map<String, dynamic>),
        needsProfileToken: json['needs_profile_token'] as String?,
        accountId: json['account_id'] as String?,
      );
}

/// The contract's Error schema (docs/phase-2/openapi.yaml), plus Retry-After when present.
class ApiException implements Exception {
  const ApiException({
    required this.statusCode,
    required this.code,
    required this.message,
    this.correlationId,
    this.retryAfterSeconds,
  });

  final int statusCode;
  final String code;
  final String message;
  final String? correlationId;
  final int? retryAfterSeconds;

  @override
  String toString() => 'ApiException($statusCode $code: $message)';
}

/// Thin typed wrapper over the API's Phase 3 surface (health + OTP sign-in). Grows module by
/// module as later phases add endpoints; not a generated client because the Dart generator
/// (openapi-generator) needs a Java toolchain not available in this environment — see the
/// Phase 3 report for what remains to wire up.
class ApiClient {
  ApiClient({Dio? dio})
    : _dio = dio ?? Dio(BaseOptions(baseUrl: ApiConfig.baseUrl));

  final Dio _dio;

  Future<HealthReport> getHealth() async {
    final res = await _dio.get<Map<String, dynamic>>('/health');
    return HealthReport.fromJson(res.data!);
  }

  Future<T> _send<T>(
    Future<Response<Map<String, dynamic>>> Function() call,
    T Function(Map<String, dynamic>) parse,
  ) async {
    try {
      final res = await call();
      return parse(res.data!);
    } on DioException catch (e) {
      final data = e.response?.data;
      if (e.response != null &&
          data is Map<String, dynamic> &&
          data['code'] is String) {
        throw ApiException(
          statusCode: e.response!.statusCode ?? 0,
          code: data['code'] as String,
          message: data['message'] as String? ?? '',
          correlationId: data['correlation_id'] as String?,
          retryAfterSeconds: int.tryParse(
            e.response!.headers.value('retry-after') ?? '',
          ),
        );
      }
      rethrow;
    }
  }

  Options _bearer(String token) =>
      Options(headers: {'Authorization': 'Bearer $token'});

  Future<OtpChallenge> requestOtp({
    required String phoneE164,
    required String app,
  }) => _send(
    () => _dio.post<Map<String, dynamic>>(
      '/v1/auth/otp/request',
      data: {'phone_e164': phoneE164, 'app': app},
    ),
    OtpChallenge.fromJson,
  );

  Future<OtpVerifyResult> verifyOtp({
    required String challengeId,
    required String code,
  }) => _send(
    () => _dio.post<Map<String, dynamic>>(
      '/v1/auth/otp/verify',
      data: {'challenge_id': challengeId, 'code': code},
    ),
    OtpVerifyResult.fromJson,
  );

  Future<SessionTokens> completeProfile({
    required String needsProfileToken,
    required String firstName,
    required String lastName,
    required String gender,
    String? email,
    String? language,
    List<String> acceptedLegalVersionIds = const [],
  }) => _send(
    () => _dio.post<Map<String, dynamic>>(
      '/v1/me/complete-profile',
      data: {
        'first_name': firstName,
        'last_name': lastName,
        'gender': gender,
        'email': ?email,
        'language': ?language,
        'accepted_legal_version_ids': acceptedLegalVersionIds,
      },
      options: _bearer(needsProfileToken),
    ),
    SessionTokens.fromJson,
  );

  Future<Map<String, dynamic>> getMe(String accessToken) => _send(
    () =>
        _dio.get<Map<String, dynamic>>('/v1/me', options: _bearer(accessToken)),
    (json) => json,
  );
}
