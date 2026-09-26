// Runs the REAL Dart ApiClient against a REAL API, database, Redis and MinIO. Skipped unless
// WASSELNE_LIVE_API is set; started by `pnpm --filter @wasselne/api run e2e:dart-client`, which
// provisions everything in throwaway resources. This proves the hand-written client's paths,
// bodies and parsing match the server, including the presigned PUT to storage.
import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter_core/flutter_core.dart';
import 'package:flutter_test/flutter_test.dart';

const liveApi = String.fromEnvironment('WASSELNE_LIVE_API');
const redisCli = String.fromEnvironment(
  'WASSELNE_REDIS_CLI',
); // e.g. "docker exec wasselne-local-redis-1 redis-cli"
const redisPrefix = String.fromEnvironment('WASSELNE_REDIS_PREFIX');

Future<String> devCode(String challengeId) async {
  final parts = redisCli.split(' ');
  final r = await Process.run(parts.first, [
    ...parts.skip(1),
    'get',
    '${redisPrefix}dev:sms:$challengeId',
  ]);
  return (r.stdout as String).trim();
}

void main() {
  test(
    'sign in, complete the driver application and sign out against the real API',
    () async {
      final store = MemoryTokenStore();
      final client = ApiClient(
        dio: Dio(BaseOptions(baseUrl: liveApi)),
        tokenStore: store,
      );
      final phone =
          '+9613${1000000 + DateTime.now().microsecondsSinceEpoch % 8999999}';

      final challenge = await client.requestOtp(
        phoneE164: phone,
        app: 'DRIVER',
      );
      // a wrong code is a contract error with a code, not a crash
      await expectLater(
        client.verifyOtp(challengeId: challenge.challengeId, code: '000000'),
        throwsA(
          isA<ApiException>().having((e) => e.code, 'code', 'OTP_INVALID'),
        ),
      );
      final verified = await client.verifyOtp(
        challengeId: challenge.challengeId,
        code: await devCode(challenge.challengeId),
      );
      expect(verified.needsProfile, isTrue);

      final terms = await client.legalForSignUp(
        needsProfileToken: verified.needsProfileToken!,
        language: 'fr',
      );
      expect(terms, isEmpty); // nothing published in the throwaway database
      await client.completeProfile(
        needsProfileToken: verified.needsProfileToken!,
        firstName: 'Dana',
        lastName: 'Live',
        gender: 'FEMALE',
        language: 'fr',
      );
      final me = await client.getProfile();
      expect(me.displayName, 'Dana Live');
      expect(me.language, 'fr');
      expect(
        (await client.updateProfile(email: 'dana@example.test')).email,
        'dana@example.test',
      );

      expect(
        await client.onboardingStatus(),
        isNotNull,
      ); // created with the account
      final options = await client.onboardingOptions();
      final car = options.firstWhere((c) => c.code == 'live-car');
      expect(
        car.requiredDocuments.map((d) => d.code),
        containsAll(['live-id', 'live-reg']),
      );

      var status = await client.saveOnboardingProfile(
        firstName: 'Dana',
        lastName: 'Live',
        gender: 'FEMALE',
      );
      expect(status.status, 'ONBOARDING');
      status = await client.saveVehicle(
        baseType: 'CAR',
        make: 'Kia',
        model: 'Rio',
        color: 'Grey',
        plate: 'LIVE ${DateTime.now().millisecondsSinceEpoch % 100000}',
        seats: 4,
        year: 2020,
      );
      expect(status.checklist.vehicle, isTrue);
      status = await client.selectCategories([car.id]);
      expect(status.checklist.documentsTotal, 2);
      expect(status.categories.single.categoryId, car.id);

      // a real JPEG header, uploaded to real presigned storage
      final jpeg = [
        0xff,
        0xd8,
        0xff,
        0xe0,
        ...List.generate(300, (i) => i % 251),
      ];
      for (final doc in car.requiredDocuments) {
        final grant = await client.authorizeUpload(
          purpose: 'DRIVER_DOCUMENT',
          contentType: 'image/jpeg',
          maxBytes: jpeg.length,
        );
        await client.putToStorage(grant, jpeg);
        await client.completeUpload(grant.uploadId);
        await client.attachDocument(
          documentTypeId: doc.documentTypeId,
          uploadId: grant.uploadId,
          expiresOn: doc.hasExpiry ? '2099-01-01' : null,
        );
      }
      status = (await client.onboardingStatus())!;
      expect(status.checklist.complete, isTrue);
      status = await client.submitOnboarding();
      expect(status.status, 'SUBMITTED');
      expect(status.documents.every((d) => d.status == 'UPLOADED'), isTrue);
      // read-only once submitted: the server says so with a contract error
      await expectLater(
        client.saveVehicle(
          baseType: 'CAR',
          make: 'X',
          model: 'Y',
          color: 'Z',
          plate: 'ZZ 1',
          seats: 4,
        ),
        throwsA(
          isA<ApiException>().having((e) => e.code, 'code', 'INVALID_STATE'),
        ),
      );

      // a non-image upload is refused by the server on completion
      final bad = await client.authorizeUpload(
        purpose: 'DRIVER_DOCUMENT',
        contentType: 'image/jpeg',
        maxBytes: 100,
      );
      await client.putToStorage(bad, 'MZ-not-an-image'.codeUnits);
      await expectLater(
        client.completeUpload(bad.uploadId),
        throwsA(
          isA<ApiException>().having((e) => e.code, 'code', 'UPLOAD_INVALID'),
        ),
      );

      await client.logout();
      expect(await store.read(), isNull);
    },
    skip: liveApi.isEmpty
        ? 'set WASSELNE_LIVE_API (see e2e:dart-client)'
        : false,
  );

  test(
    'a real refresh rotation, and reuse of the old token kills the session',
    () async {
      final store = MemoryTokenStore();
      final client = ApiClient(
        dio: Dio(BaseOptions(baseUrl: liveApi)),
        tokenStore: store,
      );
      final phone =
          '+9613${1000000 + (DateTime.now().microsecondsSinceEpoch + 7) % 8999999}';
      final ch = await client.requestOtp(phoneE164: phone, app: 'RIDER');
      final v = await client.verifyOtp(
        challengeId: ch.challengeId,
        code: await devCode(ch.challengeId),
      );
      await client.completeProfile(
        needsProfileToken: v.needsProfileToken!,
        firstName: 'Rana',
        lastName: 'Live',
        gender: 'FEMALE',
      );
      final first = (await store.read())!;

      // expire the access token's acceptance by presenting a garbage one: the client must refresh once and retry
      await store.write(
        SessionTokens(
          accessToken: 'garbage',
          refreshToken: first.refreshToken,
          expiresAt: first.expiresAt,
        ),
      );
      expect((await client.getProfile()).firstName, 'Rana');
      final rotated = (await store.read())!;
      expect(rotated.refreshToken, isNot(first.refreshToken));

      // replaying the OLD refresh token (as an attacker holding it would) revokes the session
      await store.write(
        SessionTokens(
          accessToken: 'garbage',
          refreshToken: first.refreshToken,
          expiresAt: first.expiresAt,
        ),
      );
      await expectLater(client.getProfile(), throwsA(isA<ApiException>()));
      await store.write(rotated);
      await expectLater(
        client.getProfile(),
        throwsA(isA<ApiException>().having((e) => e.statusCode, 'status', 401)),
      );
    },
    skip: liveApi.isEmpty
        ? 'set WASSELNE_LIVE_API (see e2e:dart-client)'
        : false,
  );
}
