import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_core/flutter_core.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

class FakeResponse {
  const FakeResponse(this.status, [this.body, this.headers = const {}]);
  final int status;
  final Object? body;
  final Map<String, List<String>> headers;
}

class RecordedRequest {
  RecordedRequest(this.method, this.path, this.body, this.headers, this.query);
  final String method;
  final String path;
  final Object? body;
  final Map<String, dynamic> headers;
  final Map<String, dynamic> query;
}

typedef Handler = FakeResponse Function(RecordedRequest req);

/// A scripted HTTP server behind Dio: no network, every request is recorded so tests can assert
/// exactly what the app sent (paths, bodies, bearer tokens).
class FakeServer implements HttpClientAdapter {
  final Map<String, Handler> routes = {};
  final List<RecordedRequest> requests = [];

  void on(String method, String path, Handler h) => routes['$method $path'] = h;

  Iterable<RecordedRequest> to(String method, String path) =>
      requests.where((r) => r.method == method && r.path == path);

  @override
  Future<ResponseBody> fetch(
    RequestOptions options,
    Stream<Uint8List>? requestStream,
    Future<void>? cancelFuture,
  ) async {
    Object? body = options.data;
    if (body is Stream) {
      final chunks = <int>[];
      await for (final c in body) {
        chunks.addAll(c as List<int>);
      }
      body = Uint8List.fromList(chunks);
    }
    final req = RecordedRequest(
      options.method,
      options.uri.path,
      body,
      Map.of(options.headers),
      Map.of(options.queryParameters),
    );
    requests.add(req);
    final handler = routes['${options.method} ${options.uri.path}'];
    final res = handler == null
        ? FakeResponse(404, {
            'code': 'NOT_FOUND',
            'message': 'no route',
            'correlation_id': 'c-none',
          })
        : handler(req);
    return ResponseBody.fromString(
      res.body == null ? '' : jsonEncode(res.body),
      res.status,
      headers: {
        Headers.contentTypeHeader: ['application/json'],
        ...res.headers,
      },
    );
  }

  @override
  void close({bool force = false}) {}
}

Map<String, dynamic> err(String code, [String message = 'msg']) => {
  'code': code,
  'message': message,
  'correlation_id': 'ref-123',
};

SessionTokens sessionTokens([String suffix = '1']) => SessionTokens(
  accessToken: 'access-$suffix',
  refreshToken: 'refresh-$suffix',
  expiresAt: DateTime.utc(2030),
);

Map<String, dynamic> sessionJson([String suffix = '1']) => {
  'access_token': 'access-$suffix',
  'refresh_token': 'refresh-$suffix',
  'expires_at': '2030-01-01T00:00:00.000Z',
};

Map<String, dynamic> profileJson({
  String first = 'Rami',
  String last = 'Test',
  String gender = 'MALE',
}) => {
  'id': '11111111-1111-4111-8111-111111111111',
  'phone_e164': '+96170123456',
  'first_name': first,
  'last_name': last,
  'gender': gender,
  'gender_confirmed': false,
  'language': 'en',
  'status': 'ACTIVE',
};

ApiClient clientFor(FakeServer api, {FakeServer? storage, TokenStore? store}) =>
    ApiClient(
      dio: Dio(BaseOptions(baseUrl: 'http://api.test'))
        ..httpClientAdapter = api,
      storageDio: Dio()..httpClientAdapter = storage ?? FakeServer(),
      tokenStore: store ?? MemoryTokenStore(),
    );

/// A widget tree the way the apps build it: localized MaterialApp inside a ProviderScope.
Widget appFor(
  FakeServer api,
  Widget home, {
  String kind = 'DRIVER',
  Locale? locale,
  FakeServer? storage,
  TokenStore? store,
  List<Override> overrides = const [],
}) {
  final client = clientFor(api, storage: storage, store: store);
  return ProviderScope(
    overrides: [
      apiClientProvider.overrideWithValue(client),
      appKindProvider.overrideWithValue(kind),
      ...overrides,
    ],
    child: MaterialApp(
      locale: locale,
      localizationsDelegates: WasselneLocalizations.localizationsDelegates,
      supportedLocales: WasselneLocalizations.supportedLocales,
      home: home,
    ),
  );
}
