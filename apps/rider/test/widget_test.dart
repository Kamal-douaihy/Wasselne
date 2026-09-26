import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_core/flutter_core.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:rider/main.dart';

/// Minimal scripted API: path -> (status, json). Anything else is a 404 contract-shaped error.
class _Api implements HttpClientAdapter {
  _Api(this.routes);
  final Map<String, (int, Object?)> routes;
  @override
  Future<ResponseBody> fetch(
    RequestOptions o,
    Stream<Uint8List>? s,
    Future<void>? c,
  ) async {
    final r =
        routes['${o.method} ${o.uri.path}'] ??
        (404, {'code': 'NOT_FOUND', 'message': 'x', 'correlation_id': 'c'});
    return ResponseBody.fromString(
      jsonEncode(r.$2),
      r.$1,
      headers: {
        Headers.contentTypeHeader: ['application/json'],
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

Widget _app(Map<String, (int, Object?)> routes, {bool signedIn = false}) {
  final store = MemoryTokenStore();
  final client = ApiClient(
    dio: Dio(BaseOptions(baseUrl: 'http://api.test'))
      ..httpClientAdapter = _Api(routes),
    tokenStore: store,
  );
  return ProviderScope(
    overrides: [
      apiClientProvider.overrideWithValue(client),
      appKindProvider.overrideWithValue('RIDER'),
    ],
    child: FutureBuilder(
      future: signedIn
          ? store.write(
              SessionTokens(
                accessToken: 'a',
                refreshToken: 'r',
                expiresAt: DateTime.utc(2030),
              ),
            )
          : Future.value(),
      builder: (context, snapshot) =>
          snapshot.connectionState == ConnectionState.done
          ? const WasselneRiderApp()
          : const SizedBox(),
    ),
  );
}

const _me = {
  'id': '11111111-1111-4111-8111-111111111111',
  'phone_e164': '+96170123456',
  'first_name': 'Sam',
  'last_name': 'Tester',
  'gender': 'MALE',
  'gender_confirmed': false,
  'language': 'en',
  'status': 'ACTIVE',
};

void main() {
  testWidgets('starts at phone sign-in when there is no session', (
    tester,
  ) async {
    await tester.pumpWidget(_app({}));
    await tester.pumpAndSettle();
    expect(find.text('Sign in with your phone number'), findsOneWidget);
    expect(find.text('Send code'), findsOneWidget);
  });

  testWidgets(
    'a stored session opens the rider home and says booking is not available yet',
    (tester) async {
      await tester.pumpWidget(_app({'GET /v1/me': (200, _me)}, signedIn: true));
      await tester.pumpAndSettle();
      expect(find.text('Hello, Sam Tester'), findsOneWidget);
      expect(find.text('Ride booking is not available yet.'), findsOneWidget);
      expect(find.text('Wasselne'), findsWidgets);
    },
  );
}
