import 'dart:io' show SocketException;

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api_client.dart';
import '../api/models.dart';
import '../screens/system_status_screen.dart' show apiClientProvider;

/// Which app this process is: 'RIDER' or 'DRIVER'. Each app overrides it in its ProviderScope.
final appKindProvider = Provider<String>(
  (ref) => throw UnimplementedError('appKindProvider must be overridden'),
);

enum AuthPhase { restoring, signedOut, awaitingCode, needsProfile, signedIn }

enum AuthFailureKind {
  network,
  otpInvalid,
  otpExpired,
  rateLimited,
  blocked,
  termsRequired,
  generic,
}

class AuthFailure {
  const AuthFailure(this.kind, {this.retryAfterSeconds, this.reference});
  final AuthFailureKind kind;
  final int? retryAfterSeconds;
  final String? reference;

  factory AuthFailure.from(Object error) {
    if (error is ApiException) {
      switch (error.code) {
        case 'OTP_INVALID':
          return AuthFailure(
            AuthFailureKind.otpInvalid,
            reference: error.correlationId,
          );
        case 'OTP_EXPIRED':
          return AuthFailure(
            AuthFailureKind.otpExpired,
            reference: error.correlationId,
          );
        case 'OTP_RATE_LIMITED':
        case 'RATE_LIMITED':
          return AuthFailure(
            AuthFailureKind.rateLimited,
            retryAfterSeconds: error.retryAfterSeconds,
            reference: error.correlationId,
          );
        case 'ACCOUNT_BLOCKED':
          return AuthFailure(
            AuthFailureKind.blocked,
            reference: error.correlationId,
          );
        case 'TERMS_ACCEPTANCE_REQUIRED':
          return AuthFailure(
            AuthFailureKind.termsRequired,
            reference: error.correlationId,
          );
      }
      return AuthFailure(
        AuthFailureKind.generic,
        reference: error.correlationId,
      );
    }
    if (error is DioException || error is SocketException) {
      return const AuthFailure(AuthFailureKind.network);
    }
    return const AuthFailure(AuthFailureKind.generic);
  }
}

class AuthState {
  const AuthState({
    this.phase = AuthPhase.restoring,
    this.phone,
    this.challenge,
    this.needsProfileToken,
    this.profile,
    this.busy = false,
    this.failure,
  });

  final AuthPhase phase;
  final String? phone;
  final OtpChallenge? challenge;
  final String? needsProfileToken;
  final Profile? profile;
  final bool busy;
  final AuthFailure? failure;

  AuthState copyWith({
    AuthPhase? phase,
    String? phone,
    OtpChallenge? challenge,
    String? needsProfileToken,
    Profile? profile,
    bool? busy,
    AuthFailure? failure,
    bool clearFailure = false,
  }) => AuthState(
    phase: phase ?? this.phase,
    phone: phone ?? this.phone,
    challenge: challenge ?? this.challenge,
    needsProfileToken: needsProfileToken ?? this.needsProfileToken,
    profile: profile ?? this.profile,
    busy: busy ?? this.busy,
    failure: clearFailure ? null : (failure ?? this.failure),
  );
}

/// Drives phone-number sign-in for either app: phone -> code -> (profile for a new number) -> signed in.
/// The session itself lives in the ApiClient's TokenStore; this holds only what the UI needs.
class AuthController extends Notifier<AuthState> {
  ApiClient get _api => ref.read(apiClientProvider);
  String get _app => ref.read(appKindProvider);

  @override
  AuthState build() {
    // A refresh that fails (revoked session, blocked account) drops the person back to sign-in.
    _api.onSessionLost = () =>
        state = const AuthState(phase: AuthPhase.signedOut);
    Future.microtask(_restore);
    return const AuthState();
  }

  Future<void> _restore() async {
    if (!await _api.hasSession()) {
      state = const AuthState(phase: AuthPhase.signedOut);
      return;
    }
    try {
      final profile = await _api.getProfile();
      state = AuthState(phase: AuthPhase.signedIn, profile: profile);
    } on ApiException {
      await _api.tokenStore.clear();
      state = const AuthState(phase: AuthPhase.signedOut);
    } on Object {
      // Offline at start-up: keep the stored session, show sign-in only if the person retries.
      state = AuthState(
        phase: AuthPhase.signedOut,
        failure: AuthFailure.from(const SocketException('offline')),
      );
    }
  }

  static final _phone = RegExp(r'^\+[1-9][0-9]{6,14}$');
  static bool isValidPhone(String v) => _phone.hasMatch(v);

  Future<void> submitPhone(String phone) async {
    final normalized = phone.replaceAll(RegExp(r'[\s-]'), '');
    if (!isValidPhone(normalized)) return;
    state = state.copyWith(busy: true, clearFailure: true);
    try {
      final challenge = await _api.requestOtp(phoneE164: normalized, app: _app);
      state = AuthState(
        phase: AuthPhase.awaitingCode,
        phone: normalized,
        challenge: challenge,
      );
    } catch (e) {
      state = state.copyWith(busy: false, failure: AuthFailure.from(e));
    }
  }

  Future<void> resend() async {
    final phone = state.phone;
    if (phone == null) return;
    await submitPhone(phone);
  }

  void changeNumber() => state = const AuthState(phase: AuthPhase.signedOut);

  Future<void> submitCode(String code) async {
    final challenge = state.challenge;
    if (challenge == null) return;
    state = state.copyWith(busy: true, clearFailure: true);
    try {
      final result = await _api.verifyOtp(
        challengeId: challenge.challengeId,
        code: code.trim(),
      );
      if (result.needsProfile) {
        state = AuthState(
          phase: AuthPhase.needsProfile,
          phone: state.phone,
          needsProfileToken: result.needsProfileToken,
        );
      } else {
        final profile = await _api.getProfile();
        state = AuthState(phase: AuthPhase.signedIn, profile: profile);
      }
    } catch (e) {
      state = state.copyWith(busy: false, failure: AuthFailure.from(e));
    }
  }

  Future<void> completeProfile({
    required String firstName,
    required String lastName,
    required String gender,
    String? email,
    required String language,
    required List<String> acceptedLegalVersionIds,
  }) async {
    final token = state.needsProfileToken;
    if (token == null) return;
    state = state.copyWith(busy: true, clearFailure: true);
    try {
      await _api.completeProfile(
        needsProfileToken: token,
        firstName: firstName,
        lastName: lastName,
        gender: gender,
        email: email,
        language: language,
        acceptedLegalVersionIds: acceptedLegalVersionIds,
      );
      final profile = await _api.getProfile();
      state = AuthState(phase: AuthPhase.signedIn, profile: profile);
    } catch (e) {
      state = state.copyWith(busy: false, failure: AuthFailure.from(e));
    }
  }

  Future<void> signOut() async {
    await _api.logout();
    state = const AuthState(phase: AuthPhase.signedOut);
  }
}

final authControllerProvider = NotifierProvider<AuthController, AuthState>(
  AuthController.new,
);
