import 'package:dio/dio.dart';

import '../auth/token_store.dart';
import 'models.dart';
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
    this.reason,
  });

  final int statusCode;
  final String code;
  final String message;
  final String? correlationId;
  final int? retryAfterSeconds;

  /// `details.reason` for CATEGORY_NOT_ELIGIBLE and similar (machine-readable, never shown as-is).
  final String? reason;

  @override
  String toString() => 'ApiException($statusCode $code: $message)';
}

/// Typed wrapper over the API surface the apps use so far: health, OTP sign-in, session
/// refresh/logout, profile, legal documents, uploads and driver onboarding. Not a generated
/// client because the Dart generator (openapi-generator) needs a Java toolchain not available in
/// this environment; responses are parsed by hand against docs/phase-2/openapi.yaml.
///
/// Authenticated calls send the stored access token. On 401 the client rotates the refresh token
/// once (all concurrent callers share that one refresh, because refresh tokens are single-use)
/// and retries; if the refresh fails the session is cleared and [onSessionLost] runs.
class ApiClient {
  ApiClient({
    Dio? dio,
    Dio? storageDio,
    TokenStore? tokenStore,
    this.onSessionLost,
  }) : _dio = dio ?? Dio(BaseOptions(baseUrl: ApiConfig.baseUrl)),
       _storageDio = storageDio ?? Dio(),
       tokenStore = tokenStore ?? MemoryTokenStore();

  final Dio _dio;
  final Dio _storageDio; // separate: presigned storage URLs must not receive the API bearer token
  final TokenStore tokenStore;
  void Function()? onSessionLost;
  Future<bool>? _refreshing;

  Future<HealthReport> getHealth() async {
    final res = await _dio.get<Map<String, dynamic>>('/health');
    return HealthReport.fromJson(res.data!);
  }

  ApiException _toException(DioException e) {
    final data = e.response?.data;
    if (e.response != null &&
        data is Map<String, dynamic> &&
        data['code'] is String) {
      return ApiException(
        statusCode: e.response!.statusCode ?? 0,
        code: data['code'] as String,
        message: data['message'] as String? ?? '',
        correlationId: data['correlation_id'] as String?,
        retryAfterSeconds: int.tryParse(
          e.response!.headers.value('retry-after') ?? '',
        ),
        reason: data['details'] is Map<String, dynamic>
            ? (data['details'] as Map<String, dynamic>)['reason'] as String?
            : null,
      );
    }
    throw e; // network failure, timeout: the UI shows its own "no connection" state
  }

  Future<T> _send<T>(
    Future<Response<Object?>> Function() call,
    T Function(Object? json) parse,
  ) async {
    try {
      return parse((await call()).data);
    } on DioException catch (e) {
      throw _toException(e);
    }
  }

  Options _bearer(String token) =>
      Options(headers: {'Authorization': 'Bearer $token'});

  /// Authenticated call with a single refresh-and-retry on 401.
  Future<T> _authed<T>(
    Future<Response<Object?>> Function(Options options) call,
    T Function(Object? json) parse,
  ) async {
    Future<T> once() async {
      final session = await tokenStore.read();
      if (session == null) {
        throw const ApiException(
          statusCode: 401,
          code: 'NOT_AUTHENTICATED',
          message: 'Signed out',
        );
      }
      return _send(() => call(_bearer(session.accessToken)), parse);
    }

    try {
      return await once();
    } on ApiException catch (e) {
      if (e.statusCode != 401) rethrow;
      if (!await _refreshOnce()) rethrow;
      return once();
    }
  }

  Future<bool> _refreshOnce() =>
      _refreshing ??= _doRefresh().whenComplete(() => _refreshing = null);

  Future<bool> _doRefresh() async {
    final session = await tokenStore.read();
    if (session == null) return false;
    try {
      final fresh = await _send(
        () => _dio.post<Object?>(
          '/v1/auth/token/refresh',
          data: {'refresh_token': session.refreshToken},
        ),
        (j) => SessionTokens.fromJson(j! as Map<String, dynamic>),
      );
      await tokenStore.write(fresh);
      return true;
    } on ApiException {
      await tokenStore.clear();
      onSessionLost?.call();
      return false;
    }
  }

  // ---------------------------------------------------------------- sign-in

  Future<OtpChallenge> requestOtp({
    required String phoneE164,
    required String app,
  }) => _send(
    () => _dio.post<Object?>(
      '/v1/auth/otp/request',
      data: {'phone_e164': phoneE164, 'app': app},
    ),
    (j) => OtpChallenge.fromJson(j! as Map<String, dynamic>),
  );

  /// Stores the session when the account already exists; the caller stores nothing for NEEDS_PROFILE.
  Future<OtpVerifyResult> verifyOtp({
    required String challengeId,
    required String code,
  }) async {
    final result = await _send(
      () => _dio.post<Object?>(
        '/v1/auth/otp/verify',
        data: {'challenge_id': challengeId, 'code': code},
      ),
      (j) => OtpVerifyResult.fromJson(j! as Map<String, dynamic>),
    );
    if (result.session != null) await tokenStore.write(result.session!);
    return result;
  }

  Future<SessionTokens> completeProfile({
    required String needsProfileToken,
    required String firstName,
    required String lastName,
    required String gender,
    String? email,
    String? language,
    List<String> acceptedLegalVersionIds = const [],
  }) async {
    final tokens = await _send(
      () => _dio.post<Object?>(
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
      (j) => SessionTokens.fromJson(j! as Map<String, dynamic>),
    );
    await tokenStore.write(tokens);
    return tokens;
  }

  /// Signs out on the server (best effort) and always clears the local session.
  Future<void> logout() async {
    final session = await tokenStore.read();
    try {
      if (session != null) {
        await _send(
          () => _dio.post<Object?>(
            '/v1/auth/logout',
            data: {'refresh_token': session.refreshToken},
            options: _bearer(session.accessToken),
          ),
          (_) {},
        );
      }
    } on ApiException {
      // already invalid on the server: nothing more to revoke
    } on DioException {
      // offline: the local session is still removed below
    } finally {
      await tokenStore.clear();
    }
  }

  Future<bool> hasSession() async => (await tokenStore.read()) != null;

  // ---------------------------------------------------------------- profile and legal

  Future<Map<String, dynamic>> getMe(String accessToken) => _send(
    () => _dio.get<Object?>('/v1/me', options: _bearer(accessToken)),
    (j) => j! as Map<String, dynamic>,
  );

  Future<Profile> getProfile() => _authed(
    (o) => _dio.get<Object?>('/v1/me', options: o),
    (j) => Profile.fromJson(j! as Map<String, dynamic>),
  );

  Future<Profile> updateProfile({
    String? firstName,
    String? lastName,
    String? email,
    String? language,
  }) => _authed(
    (o) => _dio.patch<Object?>(
      '/v1/me',
      data: {
        'first_name': ?firstName,
        'last_name': ?lastName,
        'email': ?email,
        'language': ?language,
      },
      options: o,
    ),
    (j) => Profile.fromJson(j! as Map<String, dynamic>),
  );

  List<LegalDocument> _legal(Object? j) => [
    for (final d in j! as List<dynamic>)
      LegalDocument.fromJson(d as Map<String, dynamic>),
  ];

  Future<List<LegalDocument>> legalCurrent() => _authed(
    (o) => _dio.get<Object?>('/v1/legal/current', options: o),
    _legal,
  );

  /// The terms shown at sign-up, before an account exists: authorized by the needs-profile token,
  /// text in [language].
  Future<List<LegalDocument>> legalForSignUp({
    required String needsProfileToken,
    required String language,
  }) => _send(
    () => _dio.get<Object?>(
      '/v1/legal/current',
      queryParameters: {'language': language},
      options: _bearer(needsProfileToken),
    ),
    _legal,
  );

  Future<void> legalAccept(String versionId) => _authed(
    (o) => _dio.post<Object?>(
      '/v1/legal/$versionId/accept',
      data: <String, dynamic>{},
      options: o,
    ),
    (_) {},
  );

  // ---------------------------------------------------------------- uploads

  Future<UploadGrant> authorizeUpload({
    required String purpose,
    required String contentType,
    required int maxBytes,
  }) => _authed(
    (o) => _dio.post<Object?>(
      '/v1/uploads/authorize',
      data: {
        'purpose': purpose,
        'content_type': contentType,
        'max_bytes': maxBytes,
      },
      options: o,
    ),
    (j) => UploadGrant.fromJson(j! as Map<String, dynamic>),
  );

  /// Direct PUT to the presigned URL. Uses a separate Dio: this request must NOT carry the API's
  /// bearer token, and the URL is on the storage host, not the API host.
  Future<void> putToStorage(UploadGrant grant, List<int> bytes) async {
    try {
      await _storageDio.put<Object?>(
        grant.putUrl,
        data: Stream.fromIterable([bytes]),
        options: Options(
          headers: {
            ...grant.requiredHeaders,
            Headers.contentLengthHeader: bytes.length,
          },
        ),
      );
    } on DioException catch (e) {
      throw ApiException(
        statusCode: e.response?.statusCode ?? 0,
        code: 'UPLOAD_INVALID',
        message: 'The file could not be uploaded.',
      );
    }
  }

  Future<void> completeUpload(String uploadId) => _authed(
    (o) => _dio.post<Object?>('/v1/uploads/$uploadId/complete', options: o),
    (_) {},
  );

  // ---------------------------------------------------------------- driver onboarding

  DriverOnboardingStatus _status(Object? j) =>
      DriverOnboardingStatus.fromJson(j! as Map<String, dynamic>);

  Future<List<CategoryOption>> onboardingOptions() => _authed(
    (o) => _dio.get<Object?>('/v1/driver/onboarding/options', options: o),
    (j) => [
      for (final c
          in (j! as Map<String, dynamic>)['categories'] as List<dynamic>)
        CategoryOption.fromJson(c as Map<String, dynamic>),
    ],
  );

  /// Null when the driver has not started an application yet (404 before the profile step).
  Future<DriverOnboardingStatus?> onboardingStatus() async {
    try {
      return await _authed(
        (o) => _dio.get<Object?>('/v1/driver/onboarding/status', options: o),
        _status,
      );
    } on ApiException catch (e) {
      if (e.statusCode == 404) return null;
      rethrow;
    }
  }

  Future<DriverOnboardingStatus> saveOnboardingProfile({
    required String firstName,
    required String lastName,
    required String gender,
    String? email,
    List<String> acceptedLegalVersionIds = const [],
  }) => _authed(
    (o) => _dio.post<Object?>(
      '/v1/driver/onboarding/profile',
      data: {
        'first_name': firstName,
        'last_name': lastName,
        'gender': gender,
        'email': ?email,
        'accepted_legal_version_ids': acceptedLegalVersionIds,
      },
      options: o,
    ),
    _status,
  );

  Future<DriverOnboardingStatus> saveVehicle({
    required String baseType,
    required String make,
    required String model,
    required String color,
    required String plate,
    required int seats,
    int? year,
  }) => _authed(
    (o) => _dio.post<Object?>(
      '/v1/driver/onboarding/vehicle',
      data: {
        'base_type': baseType,
        'make': make,
        'model': model,
        'color': color,
        'plate': plate,
        'seats': seats,
        'year': year,
      },
      options: o,
    ),
    _status,
  );

  Future<DriverOnboardingStatus> selectCategories(List<String> categoryIds) =>
      _authed(
        (o) => _dio.post<Object?>(
          '/v1/driver/onboarding/categories',
          data: {'category_ids': categoryIds},
          options: o,
        ),
        _status,
      );

  Future<DriverDocument> attachDocument({
    required String documentTypeId,
    required String uploadId,
    String? expiresOn,
  }) => _authed(
    (o) => _dio.post<Object?>(
      '/v1/driver/onboarding/documents',
      data: {
        'document_type_id': documentTypeId,
        'upload_id': uploadId,
        'expires_on': ?expiresOn,
      },
      options: o,
    ),
    (j) => DriverDocument.fromJson(j! as Map<String, dynamic>),
  );

  Future<DriverOnboardingStatus> submitOnboarding() => _authed(
    (o) => _dio.post<Object?>('/v1/driver/onboarding/submit', options: o),
    _status,
  );
}
