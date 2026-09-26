import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import '../api/api_client.dart';

/// Where the session survives app restarts. The refresh token is a long-lived credential, so the
/// real store keeps it in the platform keystore (Keychain / Android Keystore-backed storage).
abstract class TokenStore {
  Future<SessionTokens?> read();
  Future<void> write(SessionTokens tokens);
  Future<void> clear();
}

class MemoryTokenStore implements TokenStore {
  SessionTokens? _tokens;
  @override
  Future<SessionTokens?> read() async => _tokens;
  @override
  Future<void> write(SessionTokens tokens) async => _tokens = tokens;
  @override
  Future<void> clear() async => _tokens = null;
}

/// Backed by flutter_secure_storage. Not exercised on a physical device in Phase 4 (see the
/// Phase 4 report): unit tests use [MemoryTokenStore].
class SecureTokenStore implements TokenStore {
  SecureTokenStore({
    FlutterSecureStorage? storage,
    this.key = 'wasselne.session',
  }) : _storage = storage ?? const FlutterSecureStorage();

  final FlutterSecureStorage _storage;
  final String key;

  @override
  Future<SessionTokens?> read() async {
    final raw = await _storage.read(key: key);
    if (raw == null) return null;
    try {
      return SessionTokens.fromJson(jsonDecode(raw) as Map<String, dynamic>);
    } catch (_) {
      await _storage.delete(key: key); // unreadable: treat as signed out
      return null;
    }
  }

  @override
  Future<void> write(SessionTokens tokens) => _storage.write(
    key: key,
    value: jsonEncode({
      'access_token': tokens.accessToken,
      'refresh_token': tokens.refreshToken,
      'expires_at': tokens.expiresAt.toIso8601String(),
    }),
  );

  @override
  Future<void> clear() => _storage.delete(key: key);
}
