import 'dart:async';

import 'package:flutter_core/flutter_core.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fake_server.dart';

void main() {
  test('an authenticated call sends the stored access token', () async {
    final api = FakeServer()
      ..on('GET', '/v1/me', (_) => FakeResponse(200, profileJson()));
    final store = MemoryTokenStore();
    await store.write(sessionTokens());
    final profile = await clientFor(api, store: store).getProfile();
    expect(profile.displayName, 'Rami Test');
    expect(api.requests.single.headers['Authorization'], 'Bearer access-1');
  });

  test(
    'a 401 rotates the refresh token once, stores the new pair and retries',
    () async {
      var meCalls = 0;
      final api = FakeServer()
        ..on('GET', '/v1/me', (r) {
          meCalls++;
          return r.headers['Authorization'] == 'Bearer access-2'
              ? FakeResponse(200, profileJson())
              : FakeResponse(401, err('NOT_AUTHENTICATED'));
        })
        ..on(
          'POST',
          '/v1/auth/token/refresh',
          (r) => FakeResponse(200, sessionJson('2')),
        );
      final store = MemoryTokenStore();
      await store.write(sessionTokens());
      final client = clientFor(api, store: store);
      expect((await client.getProfile()).id, isNotEmpty);
      expect(meCalls, 2);
      expect(
        (api.to('POST', '/v1/auth/token/refresh').single.body
            as Map)['refresh_token'],
        'refresh-1',
      );
      expect((await store.read())!.refreshToken, 'refresh-2');
    },
  );

  test(
    'concurrent 401s share ONE refresh (refresh tokens are single-use)',
    () async {
      final refresh = Completer<void>();
      final api = FakeServer()
        ..on(
          'GET',
          '/v1/me',
          (r) => r.headers['Authorization'] == 'Bearer access-2'
              ? FakeResponse(200, profileJson())
              : FakeResponse(401, err('NOT_AUTHENTICATED')),
        )
        ..on(
          'GET',
          '/v1/legal/current',
          (r) => r.headers['Authorization'] == 'Bearer access-2'
              ? const FakeResponse(200, [])
              : FakeResponse(401, err('NOT_AUTHENTICATED')),
        )
        ..on(
          'POST',
          '/v1/auth/token/refresh',
          (_) => FakeResponse(200, sessionJson('2')),
        );
      final store = MemoryTokenStore();
      await store.write(sessionTokens());
      final client = clientFor(api, store: store);
      final both = Future.wait([client.getProfile(), client.legalCurrent()]);
      if (!refresh.isCompleted) refresh.complete();
      await both;
      expect(api.to('POST', '/v1/auth/token/refresh'), hasLength(1));
    },
  );

  test('a failed refresh clears the session and reports it lost', () async {
    var lost = 0;
    final api = FakeServer()
      ..on('GET', '/v1/me', (_) => FakeResponse(401, err('NOT_AUTHENTICATED')))
      ..on(
        'POST',
        '/v1/auth/token/refresh',
        (_) => FakeResponse(401, err('NOT_AUTHENTICATED')),
      );
    final store = MemoryTokenStore();
    await store.write(sessionTokens());
    final client = clientFor(api, store: store)..onSessionLost = () => lost++;
    await expectLater(
      client.getProfile(),
      throwsA(isA<ApiException>().having((e) => e.statusCode, 'status', 401)),
    );
    expect(await store.read(), isNull);
    expect(lost, 1);
  });

  test('a non-401 error is not retried and keeps the session', () async {
    final api = FakeServer()
      ..on('GET', '/v1/me', (_) => FakeResponse(403, err('ACCOUNT_BLOCKED')));
    final store = MemoryTokenStore();
    await store.write(sessionTokens());
    await expectLater(
      clientFor(api, store: store).getProfile(),
      throwsA(
        isA<ApiException>().having((e) => e.code, 'code', 'ACCOUNT_BLOCKED'),
      ),
    );
    expect(api.requests, hasLength(1));
    expect(await store.read(), isNotNull);
  });

  test('logout revokes on the server and always clears the local session, even if the server call fails', () async {
    final api = FakeServer()
      ..on(
        'POST',
        '/v1/auth/logout',
        (_) => FakeResponse(401, err('NOT_AUTHENTICATED')),
      );
    final store = MemoryTokenStore();
    await store.write(sessionTokens());
    await clientFor(api, store: store).logout();
    expect((api.requests.single.body as Map)['refresh_token'], 'refresh-1');
    expect(await store.read(), isNull);
  });

  test(
    'presigned uploads go to the storage host without the API bearer token',
    () async {
      final api = FakeServer();
      final storage = FakeServer()
        ..on('PUT', '/bucket/key', (_) => const FakeResponse(200));
      final store = MemoryTokenStore();
      await store.write(sessionTokens());
      final client = clientFor(api, storage: storage, store: store);
      await client.putToStorage(
        const UploadGrant(
          uploadId: 'u1',
          putUrl: 'http://storage.test/bucket/key?X-Amz-Signature=abc',
          requiredHeaders: {'Content-Type': 'image/jpeg'},
        ),
        [1, 2, 3],
      );
      final sent = storage.requests.single;
      expect(sent.headers.containsKey('Authorization'), isFalse);
      expect(sent.headers['Content-Type'], 'image/jpeg');
      expect(sent.body, [1, 2, 3]);
      expect(api.requests, isEmpty);
    },
  );

  test('a failed storage PUT surfaces as UPLOAD_INVALID', () async {
    final storage = FakeServer()
      ..on('PUT', '/bucket/key', (_) => FakeResponse(403, err('x')));
    await expectLater(
      clientFor(FakeServer(), storage: storage).putToStorage(
        const UploadGrant(
          uploadId: 'u',
          putUrl: 'http://storage.test/bucket/key',
          requiredHeaders: {},
        ),
        [1],
      ),
      throwsA(
        isA<ApiException>().having((e) => e.code, 'code', 'UPLOAD_INVALID'),
      ),
    );
  });

  test('onboarding status: 404 before the first step means "not started", other errors propagate', () async {
    final api = FakeServer()
      ..on(
        'GET',
        '/v1/driver/onboarding/status',
        (_) => FakeResponse(404, err('NOT_FOUND')),
      );
    final store = MemoryTokenStore();
    await store.write(sessionTokens());
    expect(await clientFor(api, store: store).onboardingStatus(), isNull);
    api.on(
      'GET',
      '/v1/driver/onboarding/status',
      (_) => FakeResponse(403, err('NOT_AUTHORIZED')),
    );
    await expectLater(
      clientFor(api, store: store).onboardingStatus(),
      throwsA(isA<ApiException>()),
    );
  });

  test(
    'ApiException carries the correlation id, Retry-After and details.reason',
    () async {
      final api = FakeServer()
        ..on(
          'POST',
          '/v1/auth/otp/request',
          (_) => FakeResponse(429, err('OTP_RATE_LIMITED'), {
            'retry-after': ['17'],
          }),
        )
        ..on(
          'POST',
          '/v1/driver/onboarding/categories',
          (_) => FakeResponse(403, {
            ...err('CATEGORY_NOT_ELIGIBLE'),
            'details': {'reason': 'SEATS'},
          }),
        );
      final store = MemoryTokenStore();
      await store.write(sessionTokens());
      final client = clientFor(api, store: store);
      await expectLater(
        client.requestOtp(phoneE164: '+96170123456', app: 'RIDER'),
        throwsA(
          isA<ApiException>()
              .having((e) => e.retryAfterSeconds, 'retry', 17)
              .having((e) => e.correlationId, 'ref', 'ref-123'),
        ),
      );
      await expectLater(
        client.selectCategories(['c']),
        throwsA(isA<ApiException>().having((e) => e.reason, 'reason', 'SEATS')),
      );
    },
  );
}
