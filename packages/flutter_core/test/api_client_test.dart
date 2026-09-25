import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter_core/flutter_core.dart';
import 'package:flutter_test/flutter_test.dart';

/// Replays canned contract-shaped responses so no network or server is needed.
class _FakeAdapter implements HttpClientAdapter {
  _FakeAdapter(this.status, this.body, [this.headers = const {}]);
  final int status;
  final Map<String, dynamic> body;
  final Map<String, List<String>> headers;
  RequestOptions? last;

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    last = options;
    return ResponseBody.fromString(
      jsonEncode(body),
      status,
      headers: {
        Headers.contentTypeHeader: ['application/json'],
        ...headers,
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

ApiClient _client(_FakeAdapter a) => ApiClient(
  dio: Dio(BaseOptions(baseUrl: 'http://x'))..httpClientAdapter = a,
);

void main() {
  test(
    'requestOtp parses the contract response and sends no extra fields',
    () async {
      final a = _FakeAdapter(200, {
        'challenge_id': 'c1',
        'expires_at': '2026-09-24T12:05:00.000Z',
        'resend_after': '2026-09-24T12:00:30.000Z',
      });
      final r = await _client(a)
          .requestOtp(phoneE164: '+96170123456', app: 'RIDER');
      expect(r.challengeId, 'c1');
      expect(r.resendAfter.isBefore(r.expiresAt), isTrue);
      expect(a.last!.data, {'phone_e164': '+96170123456', 'app': 'RIDER'});
    },
  );

  test(
    'verifyOtp sends only challenge_id and code, and understands NEEDS_PROFILE',
    () async {
      final a = _FakeAdapter(200, {
        'status': 'NEEDS_PROFILE',
        'needs_profile_token': 't',
      });
      final r = await _client(a).verifyOtp(challengeId: 'c1', code: '123456');
      expect(r.needsProfile, isTrue);
      expect(r.needsProfileToken, 't');
      expect(r.session, isNull);
      expect(a.last!.data, {'challenge_id': 'c1', 'code': '123456'});
    },
  );

  test('a 429 becomes an ApiException carrying code, correlation id and Retry-After', () async {
    final a = _FakeAdapter(
      429,
      {'code': 'OTP_RATE_LIMITED', 'message': 'wait', 'correlation_id': 'abc'},
      {
        'retry-after': ['17'],
      },
    );
    await expectLater(
      _client(a).requestOtp(phoneE164: '+96170123456', app: 'RIDER'),
      throwsA(
        isA<ApiException>()
            .having((e) => e.code, 'code', 'OTP_RATE_LIMITED')
            .having((e) => e.correlationId, 'correlationId', 'abc')
            .having((e) => e.retryAfterSeconds, 'retryAfter', 17),
      ),
    );
  });
}
