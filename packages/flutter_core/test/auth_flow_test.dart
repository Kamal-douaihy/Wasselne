import 'package:flutter/material.dart';
import 'package:flutter_core/flutter_core.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fake_server.dart';

FakeServer signInServer({bool existingAccount = true}) {
  final api = FakeServer()
    ..on(
      'POST',
      '/v1/auth/otp/request',
      (_) => FakeResponse(200, {
        'challenge_id': 'ch-1',
        'expires_at': DateTime.now()
            .toUtc()
            .add(const Duration(minutes: 5))
            .toIso8601String(),
        'resend_after': DateTime.now()
            .toUtc()
            .add(const Duration(seconds: 30))
            .toIso8601String(),
      }),
    )
    ..on('POST', '/v1/auth/otp/verify', (r) {
      final code = (r.body as Map)['code'];
      if (code != '123456') return FakeResponse(400, err('OTP_INVALID'));
      return existingAccount
          ? FakeResponse(200, {
              'status': 'SESSION',
              'session': sessionJson(),
              'account_id': 'a1',
            })
          : const FakeResponse(200, {
              'status': 'NEEDS_PROFILE',
              'needs_profile_token': 'needs-1',
            });
    })
    ..on('GET', '/v1/me', (_) => FakeResponse(200, profileJson()))
    ..on(
      'POST',
      '/v1/me/complete-profile',
      (_) => FakeResponse(201, sessionJson()),
    );
  return api;
}

Widget signIn(
  FakeServer api, {
  String kind = 'RIDER',
  Locale? locale,
  TokenStore? store,
}) => appFor(
  api,
  SignInFlow(
    signedIn: (context, profile) =>
        Scaffold(body: Text('HOME ${profile.displayName}')),
  ),
  kind: kind,
  locale: locale,
  store: store,
);

Future<void> enterPhone(WidgetTester t, String phone) async {
  await t.enterText(find.byType(TextFormField), phone);
  await t.tap(find.text('Send code'));
  await t.pumpAndSettle();
}

void main() {
  testWidgets(
    'shows the phone step first and refuses a number without a country code',
    (t) async {
      final api = signInServer();
      await t.pumpWidget(signIn(api));
      await t.pumpAndSettle();
      expect(find.text('Sign in with your phone number'), findsOneWidget);
      await enterPhone(t, '70123456');
      expect(
        find.text('Enter the number with its country code, digits only.'),
        findsOneWidget,
      );
      expect(api.to('POST', '/v1/auth/otp/request'), isEmpty);
    },
  );

  testWidgets(
    'sends exactly phone_e164 + app, tidies spaces, then shows the code step',
    (t) async {
      final api = signInServer();
      await t.pumpWidget(signIn(api, kind: 'DRIVER'));
      await t.pumpAndSettle();
      await enterPhone(t, '+961 70-123 456');
      final body = api.to('POST', '/v1/auth/otp/request').single.body as Map;
      expect(body, {'phone_e164': '+96170123456', 'app': 'DRIVER'});
      expect(find.text('We sent a code to +96170123456.'), findsOneWidget);
    },
  );

  testWidgets(
    'the resend button follows the server-provided resend_after countdown',
    (t) async {
      final api = signInServer();
      await t.pumpWidget(signIn(api));
      await t.pumpAndSettle();
      await enterPhone(t, '+96170123456');
      expect(find.textContaining('Send a new code in'), findsOneWidget);
      final label = find.textContaining('Send a new code in');
      final resend = t.widget<TextButton>(
        find.ancestor(of: label, matching: find.byType(TextButton)),
      );
      expect(resend.onPressed, isNull);
      await t.pumpWidget(const SizedBox()); // dispose timers
    },
  );

  testWidgets(
    'a wrong code shows a message in the person\'s language and stays on the step',
    (t) async {
      final api = signInServer();
      await t.pumpWidget(signIn(api));
      await t.pumpAndSettle();
      await enterPhone(t, '+96170123456');
      await t.enterText(find.byType(TextField), '000000');
      await t.pump();
      await t.tap(find.text('Verify'));
      await t.pumpAndSettle();
      expect(find.text('That code is not correct.'), findsOneWidget);
      expect(find.textContaining('HOME'), findsNothing);
      await t.pumpWidget(const SizedBox());
    },
  );

  testWidgets(
    'a correct code for an existing account signs in and shows the app',
    (t) async {
      final api = signInServer();
      final store = MemoryTokenStore();
      await t.pumpWidget(signIn(api, store: store));
      await t.pumpAndSettle();
      await enterPhone(t, '+96170123456');
      await t.enterText(find.byType(TextField), '123456');
      await t.pump();
      await t.tap(find.text('Verify'));
      await t.pumpAndSettle();
      expect(find.text('HOME Rami Test'), findsOneWidget);
      expect((await store.read())!.accessToken, 'access-1');
      // the verify call carries only challenge_id + code
      expect(api.to('POST', '/v1/auth/otp/verify').single.body, {
        'challenge_id': 'ch-1',
        'code': '123456',
      });
      await t.pumpWidget(const SizedBox());
    },
  );

  testWidgets(
    'rate limiting says how long to wait; a blocked account gets the blocked message',
    (t) async {
      final api = signInServer()
        ..on(
          'POST',
          '/v1/auth/otp/request',
          (_) => FakeResponse(429, err('OTP_RATE_LIMITED'), {
            'retry-after': ['42'],
          }),
        );
      await t.pumpWidget(signIn(api));
      await t.pumpAndSettle();
      await enterPhone(t, '+96170123456');
      expect(find.text('Too many attempts. Try again in 42s.'), findsOneWidget);

      api.on(
        'POST',
        '/v1/auth/otp/request',
        (_) => FakeResponse(403, err('ACCOUNT_BLOCKED')),
      );
      await t.tap(find.text('Send code'));
      await t.pumpAndSettle();
      expect(
        find.text('This account is blocked. Contact support.'),
        findsOneWidget,
      );
    },
  );

  testWidgets('offline shows the connection message, not a raw error', (
    t,
  ) async {
    final api = FakeServer()
      ..on('POST', '/v1/auth/otp/request', (_) => throw Exception('no route'));
    await t.pumpWidget(signIn(api));
    await t.pumpAndSettle();
    await enterPhone(t, '+96170123456');
    expect(
      find.text('No connection. Check your internet and try again.'),
      findsOneWidget,
    );
    expect(find.textContaining('Exception'), findsNothing); // never a raw error
  });

  testWidgets(
    'a new number: terms are fetched with the sign-up token and must be accepted before continuing',
    (t) async {
      final api = signInServer(existingAccount: false)
        ..on(
          'GET',
          '/v1/legal/current',
          (_) => const FakeResponse(200, [
            {
              'id': 'doc-1',
              'doc_type': 'TERMS',
              'version_no': 1,
              'requires_reacceptance': false,
              'language': 'en',
              'title': 'Terms of use',
              'body_markdown': 'placeholder',
            },
          ]),
        );
      await t.pumpWidget(signIn(api));
      await t.pumpAndSettle();
      await enterPhone(t, '+96170123456');
      await t.enterText(find.byType(TextField), '123456');
      await t.pump();
      await t.tap(find.text('Verify'));
      await t.pumpAndSettle();

      expect(find.text('Create your profile'), findsOneWidget);
      final legalReq = api.to('GET', '/v1/legal/current').single;
      expect(legalReq.headers['Authorization'], 'Bearer needs-1');
      expect(legalReq.query['language'], 'en');

      await t.enterText(
        find.widgetWithText(TextFormField, 'First name'),
        'Nour',
      );
      await t.enterText(
        find.widgetWithText(TextFormField, 'Last name'),
        'Haddad',
      );
      await t.tap(find.text('Female'));
      await t.pump();
      await t.ensureVisible(find.text('Continue'));
      expect(
        t
            .widget<FilledButton>(find.widgetWithText(FilledButton, 'Continue'))
            .onPressed,
        isNull,
      ); // terms not accepted yet
      await t.tap(find.text('I accept: Terms of use'));
      await t.pump();
      await t.tap(find.text('Continue'));
      await t.pumpAndSettle();

      final body = api.to('POST', '/v1/me/complete-profile').single.body as Map;
      expect(body['first_name'], 'Nour');
      expect(body['gender'], 'FEMALE');
      expect(body['accepted_legal_version_ids'], ['doc-1']);
      expect(body['language'], 'en');
      expect(find.textContaining('HOME'), findsOneWidget);
    },
  );

  testWidgets('the profile step needs a gender before it submits', (t) async {
    final api = signInServer(existingAccount: false)
      ..on('GET', '/v1/legal/current', (_) => const FakeResponse(200, []));
    await t.pumpWidget(signIn(api));
    await t.pumpAndSettle();
    await enterPhone(t, '+96170123456');
    await t.enterText(find.byType(TextField), '123456');
    await t.pump();
    await t.tap(find.text('Verify'));
    await t.pumpAndSettle();
    await t.enterText(find.widgetWithText(TextFormField, 'First name'), 'A');
    await t.enterText(find.widgetWithText(TextFormField, 'Last name'), 'B');
    await t.ensureVisible(find.text('Continue'));
    await t.tap(find.text('Continue'));
    await t.pumpAndSettle();
    expect(find.text('Required'), findsWidgets);
    expect(api.to('POST', '/v1/me/complete-profile'), isEmpty);
  });

  testWidgets(
    'a stored session restores straight into the app without asking for a phone number',
    (t) async {
      final api = signInServer();
      final store = MemoryTokenStore();
      await store.write(sessionTokens());
      await t.pumpWidget(signIn(api, store: store));
      await t.pumpAndSettle();
      expect(find.text('HOME Rami Test'), findsOneWidget);
      expect(find.text('Sign in with your phone number'), findsNothing);
    },
  );

  testWidgets(
    'a revoked stored session drops back to sign-in and clears the token',
    (t) async {
      final api = FakeServer()
        ..on(
          'GET',
          '/v1/me',
          (_) => FakeResponse(401, err('NOT_AUTHENTICATED')),
        )
        ..on(
          'POST',
          '/v1/auth/token/refresh',
          (_) => FakeResponse(401, err('NOT_AUTHENTICATED')),
        );
      final store = MemoryTokenStore();
      await store.write(sessionTokens());
      await t.pumpWidget(signIn(api, store: store));
      await t.pumpAndSettle();
      expect(find.text('Sign in with your phone number'), findsOneWidget);
      expect(await store.read(), isNull);
    },
  );

  testWidgets('sign-out returns to the phone step and calls the server', (
    t,
  ) async {
    final api = signInServer()
      ..on('POST', '/v1/auth/logout', (_) => const FakeResponse(204));
    final store = MemoryTokenStore();
    await store.write(sessionTokens());
    await t.pumpWidget(
      appFor(
        api,
        SignInFlow(
          signedIn: (context, profile) => Consumer(
            builder: (context, ref, _) => Scaffold(
              body: TextButton(
                onPressed: () =>
                    ref.read(authControllerProvider.notifier).signOut(),
                child: const Text('OUT'),
              ),
            ),
          ),
        ),
        store: store,
      ),
    );
    await t.pumpAndSettle();
    await t.tap(find.text('OUT'));
    await t.pumpAndSettle();
    expect(find.text('Sign in with your phone number'), findsOneWidget);
    expect(api.to('POST', '/v1/auth/logout'), hasLength(1));
    expect(await store.read(), isNull);
  });

  testWidgets(
    'Arabic renders right-to-left with Arabic copy; French shows French copy',
    (t) async {
      final api = signInServer();
      await t.pumpWidget(signIn(api, locale: const Locale('ar')));
      await t.pumpAndSettle();
      expect(find.text('سجّل الدخول برقم هاتفك'), findsOneWidget);
      expect(
        Directionality.of(t.element(find.byType(TextFormField))),
        TextDirection.rtl,
      );
      // the phone number itself stays left-to-right so digits are not reordered
      expect(
        t.widget<TextField>(find.byType(TextField)).textDirection,
        TextDirection.ltr,
      );

      await t.pumpWidget(signIn(api, locale: const Locale('fr')));
      await t.pumpAndSettle();
      expect(find.text('Envoyer le code'), findsOneWidget);
    },
  );
}
