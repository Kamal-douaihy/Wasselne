import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_core/flutter_core.dart';
import 'package:flutter_test/flutter_test.dart';

import 'support/fake_server.dart';

class FakePicker implements DocumentPicker {
  FakePicker(this.file);
  final PickedFile? file;
  int calls = 0;
  @override
  Future<PickedFile?> pick({required bool camera}) async {
    calls++;
    return file;
  }
}

final jpeg = PickedFile(
  Uint8List.fromList([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]),
  'image/jpeg',
);
final notAnImage = PickedFile(
  Uint8List.fromList('MZ....'.codeUnits),
  'application/octet-stream',
);

/// Stateful stand-in for the driver endpoints: enough of the real server's rules (checklist
/// arithmetic, women-only refusal, 422 on incomplete submit) to drive the screen end to end.
class DriverServer {
  DriverServer({this.gender = 'MALE', String? initialStatus}) {
    if (initialStatus != null) {
      started = true;
      profile = vehicle = true;
      categories = ['cat-car'];
      status = initialStatus;
    }
    api = FakeServer()
      ..on(
        'GET',
        '/v1/driver/onboarding/options',
        (_) => FakeResponse(200, options),
      )
      ..on('GET', '/v1/legal/current', (_) => const FakeResponse(200, []))
      ..on(
        'GET',
        '/v1/driver/onboarding/status',
        (_) => started
            ? FakeResponse(200, statusJson())
            : FakeResponse(404, err('NOT_FOUND')),
      )
      ..on('POST', '/v1/driver/onboarding/profile', (r) {
        started = profile = true;
        return FakeResponse(200, statusJson());
      })
      ..on('POST', '/v1/driver/onboarding/vehicle', (_) {
        vehicle = true;
        return FakeResponse(200, statusJson());
      })
      ..on('POST', '/v1/driver/onboarding/categories', (r) {
        final ids = List<String>.from((r.body as Map)['category_ids'] as List);
        if (ids.contains('cat-women') && gender != 'FEMALE') {
          return FakeResponse(403, {
            ...err('CATEGORY_NOT_ELIGIBLE'),
            'details': {'reason': 'WOMEN_ONLY'},
          });
        }
        categories = ids;
        return FakeResponse(200, statusJson());
      })
      ..on(
        'POST',
        '/v1/uploads/authorize',
        (r) => FakeResponse(201, {
          'upload_id': 'up-${++uploads}',
          'put_url': 'http://storage.test/obj-$uploads',
          'required_headers': {'Content-Type': (r.body as Map)['content_type']},
          'expires_at': '2030-01-01T00:00:00Z',
        }),
      )
      ..on(
        'POST',
        '/v1/uploads/up-1/complete',
        (_) => const FakeResponse(200, {
          'upload_id': 'up-1',
          'status': 'COMPLETED',
        }),
      )
      ..on(
        'POST',
        '/v1/uploads/up-2/complete',
        (_) => const FakeResponse(200, {
          'upload_id': 'up-2',
          'status': 'COMPLETED',
        }),
      )
      ..on('POST', '/v1/driver/onboarding/documents', (r) {
        final b = r.body as Map;
        docs.removeWhere((d) => d['document_type_id'] == b['document_type_id']);
        docs.add({
          'id': 'doc-${docs.length + 1}',
          'document_type_id': b['document_type_id'],
          'status': 'UPLOADED',
          'vehicle_id': null,
          'review_reason': null,
          'expires_on': b['expires_on'],
        });
        return FakeResponse(201, docs.last);
      })
      ..on('POST', '/v1/driver/onboarding/submit', (_) {
        if (!statusJson()['checklist_complete']) {
          return FakeResponse(422, {
            ...err('ONBOARDING_INCOMPLETE'),
            'details': {
              'missing': ['documents'],
            },
          });
        }
        status = 'SUBMITTED';
        return FakeResponse(200, statusJson());
      });
    storage = FakeServer()
      ..on('PUT', '/obj-1', (_) => const FakeResponse(200))
      ..on('PUT', '/obj-2', (_) => const FakeResponse(200));
  }

  final String gender;
  late final FakeServer api;
  late final FakeServer storage;
  bool started = false;
  bool profile = false;
  bool vehicle = false;
  List<String> categories = [];
  String status = 'ONBOARDING';
  String? statusReason;
  int uploads = 0;
  final List<Map<String, dynamic>> docs = [];

  static const options = {
    'categories': [
      {
        'id': 'cat-car',
        'code': 'car',
        'names': {'en': 'Car', 'ar': 'سيارة', 'fr': 'Voiture'},
        'base_type': 'CAR',
        'seats': 4,
        'female_drivers_only': false,
        'min_vehicle_year': null,
        'required_documents': [
          {
            'document_type_id': 'dt-id',
            'code': 'id',
            'names': {'en': 'National ID'},
            'subject': 'DRIVER',
            'has_expiry': false,
            'allow_gallery': true,
          },
          {
            'document_type_id': 'dt-reg',
            'code': 'reg',
            'names': {'en': 'Vehicle registration'},
            'subject': 'VEHICLE',
            'has_expiry': true,
            'allow_gallery': false,
          },
        ],
      },
      {
        'id': 'cat-women',
        'code': 'women',
        'names': {'en': 'Women taxi'},
        'base_type': 'CAR',
        'seats': 4,
        'female_drivers_only': true,
        'min_vehicle_year': null,
        'required_documents': [],
      },
    ],
  };

  Map<String, dynamic> statusJson() {
    final required = <String>{};
    for (final c in options['categories']! as List) {
      if (categories.contains((c as Map)['id'])) {
        for (final d in c['required_documents'] as List) {
          required.add((d as Map)['document_type_id'] as String);
        }
      }
    }
    final done = docs
        .where(
          (d) =>
              required.contains(d['document_type_id']) &&
              ['UPLOADED', 'APPROVED'].contains(d['status']),
        )
        .length;
    final complete =
        profile && vehicle && categories.isNotEmpty && done == required.length;
    return {
      'status': status,
      'status_reason': statusReason,
      'checklist': {
        'profile': profile,
        'vehicle': vehicle,
        'categories': categories.isNotEmpty,
        'documents_complete': done == required.length,
        'documents_total': required.length,
        'documents_done': done,
      },
      'categories': [
        for (final c in categories) {'category_id': c, 'status': 'PENDING'},
      ],
      'documents': docs,
      'checklist_complete':
          complete, // test-only field used by the fake's own submit rule
    };
  }
}

Profile driverProfile([String gender = 'MALE']) => Profile.fromJson(
  profileJson(first: 'Dana', last: 'Driver', gender: gender),
);

Future<void> pumpScreen(
  WidgetTester t,
  DriverServer s, {
  PickedFile? file,
  Locale? locale,
  FakePicker? picker,
}) async {
  t.view.physicalSize = const Size(900, 4000);
  t.view.devicePixelRatio = 1;
  addTearDown(t.view.resetPhysicalSize);
  final store = MemoryTokenStore();
  await store.write(sessionTokens());
  await t.pumpWidget(
    appFor(
      s.api,
      DriverOnboardingScreen(profile: driverProfile(s.gender)),
      locale: locale,
      storage: s.storage,
      store: store,
      overrides: [
        documentPickerProvider.overrideWithValue(
          picker ?? FakePicker(file ?? jpeg),
        ),
      ],
    ),
  );
  await t.pumpAndSettle();
}

Future<void> tapSave(WidgetTester t, String section) async {
  final b = find.descendant(
    of: find.widgetWithText(ExpansionTile, section),
    matching: find.widgetWithText(FilledButton, 'Save'),
  );
  await t.ensureVisible(b);
  await t.tap(b);
  await t.pumpAndSettle();
}

Future<void> uploadDoc(
  WidgetTester t,
  String docTitle,
  String menuItem, {
  bool pickDate = false,
}) async {
  final row = find.widgetWithText(ListTile, docTitle);
  await t.ensureVisible(row);
  await t.tap(
    find.descendant(of: row, matching: find.byType(PopupMenuButton<bool>)),
  );
  await t.pumpAndSettle();
  await t.tap(find.text(menuItem));
  await t.pumpAndSettle();
  if (pickDate) {
    await t.tap(find.text('OK'));
    await t.pumpAndSettle();
  }
}

void main() {
  testWidgets(
    'a new driver completes every step, uploads both documents and submits',
    (t) async {
      final s = DriverServer();
      await pumpScreen(t, s);
      expect(
        find.text('Complete the steps below, then submit your application.'),
        findsOneWidget,
      );
      expect(
        t
            .widget<FilledButton>(
              find.widgetWithText(FilledButton, 'Submit for review'),
            )
            .onPressed,
        isNull,
      );

      // 1 profile
      await t.tap(find.text('Male'));
      await t.pump();
      await tapSave(t, 'Personal details');
      final profileBody =
          s.api.to('POST', '/v1/driver/onboarding/profile').single.body as Map;
      expect(profileBody, {
        'first_name': 'Dana',
        'last_name': 'Driver',
        'gender': 'MALE',
        'accepted_legal_version_ids': <String>[],
      });

      // 2 vehicle
      await t.enterText(find.widgetWithText(TextField, 'Make'), 'Kia');
      await t.enterText(find.widgetWithText(TextField, 'Model'), 'Rio');
      await t.enterText(
        find.widgetWithText(TextField, 'Year (optional)'),
        '2020',
      );
      await t.enterText(find.widgetWithText(TextField, 'Colour'), 'Grey');
      await t.enterText(
        find.widgetWithText(TextField, 'Plate number'),
        'B 123456',
      );
      await t.pump();
      await tapSave(t, 'Vehicle');
      expect(s.api.to('POST', '/v1/driver/onboarding/vehicle').single.body, {
        'base_type': 'CAR',
        'make': 'Kia',
        'model': 'Rio',
        'color': 'Grey',
        'plate': 'B 123456',
        'seats': 4,
        'year': 2020,
      });

      // 3 categories
      await t.tap(find.widgetWithText(CheckboxListTile, 'Car'));
      await t.pump();
      await tapSave(t, 'Ride categories');
      expect(
        (s.api.to('POST', '/v1/driver/onboarding/categories').single.body
            as Map)['category_ids'],
        ['cat-car'],
      );
      expect(
        find.text('National ID'),
        findsOneWidget,
      ); // required documents now listed
      expect(find.text('Vehicle registration'), findsOneWidget);

      // 4 documents: the registration has an expiry date and is camera-only (no gallery entry)
      await uploadDoc(t, 'National ID', 'Choose from gallery');
      await t.tap(
        find.descendant(
          of: find.widgetWithText(ListTile, 'Vehicle registration'),
          matching: find.byType(PopupMenuButton<bool>),
        ),
      );
      await t.pumpAndSettle();
      expect(find.text('Choose from gallery'), findsNothing);
      await t.tap(find.text('Take a photo'));
      await t.pumpAndSettle();
      await t.tap(find.text('OK')); // expiry date picker
      await t.pumpAndSettle();

      final attached = s.api
          .to('POST', '/v1/driver/onboarding/documents')
          .map((r) => r.body as Map)
          .toList();
      expect(attached.map((b) => b['document_type_id']), ['dt-id', 'dt-reg']);
      expect(attached[0].containsKey('expires_on'), isFalse);
      expect(
        RegExp(r'^\d{4}-\d{2}-\d{2}$')
            .hasMatch(attached[1]['expires_on'] as String),
        isTrue,
      );
      // the bytes went to the storage host with the declared content type, and no bearer token
      final put = s.storage.to('PUT', '/obj-1').single;
      expect(put.body, jpeg.bytes);
      expect(put.headers['Content-Type'], 'image/jpeg');
      expect(put.headers.containsKey('Authorization'), isFalse);
      expect(
        (s.api.to('POST', '/v1/uploads/authorize').first.body
            as Map)['purpose'],
        'DRIVER_DOCUMENT',
      );

      // 5 submit
      final submit = find.widgetWithText(FilledButton, 'Submit for review');
      expect(t.widget<FilledButton>(submit).onPressed, isNotNull);
      await t.ensureVisible(submit);
      await t.tap(submit);
      await t.pumpAndSettle();
      expect(find.text('Your application is being reviewed.'), findsOneWidget);
      expect(
        find.widgetWithText(FilledButton, 'Submit for review'),
        findsNothing,
      ); // read-only while under review
      expect(find.widgetWithText(FilledButton, 'Save'), findsNothing);
    },
  );

  testWidgets(
    'a women-only category is labelled, and the server\'s refusal is explained',
    (t) async {
      final s = DriverServer(gender: 'MALE', initialStatus: 'ONBOARDING')
        ..categories = [];
      await pumpScreen(t, s);
      expect(find.text('Women drivers only'), findsOneWidget);
      await t.tap(find.text('Women taxi'));
      await t.pump();
      await tapSave(t, 'Ride categories');
      expect(
        find.text('This category is for women drivers only.'),
        findsOneWidget,
      );
      expect(s.categories, isEmpty);
    },
  );

  testWidgets(
    'a file that is not an accepted image is refused before anything is uploaded',
    (t) async {
      final s = DriverServer(initialStatus: 'ONBOARDING');
      await pumpScreen(t, s, file: notAnImage);
      await uploadDoc(t, 'National ID', 'Take a photo');
      expect(
        find.text('That file could not be used. Try another photo.'),
        findsOneWidget,
      );
      expect(s.api.to('POST', '/v1/uploads/authorize'), isEmpty);
    },
  );

  testWidgets('cancelling the picker changes nothing', (t) async {
    final s = DriverServer(initialStatus: 'ONBOARDING');
    final picker = FakePicker(null);
    await pumpScreen(t, s, picker: picker);
    await uploadDoc(t, 'National ID', 'Take a photo');
    expect(picker.calls, 1);
    expect(s.api.to('POST', '/v1/uploads/authorize'), isEmpty);
    expect(find.textContaining('went wrong'), findsNothing);
  });

  testWidgets('a storage failure is reported and no document is attached', (
    t,
  ) async {
    final s = DriverServer(initialStatus: 'ONBOARDING');
    s.storage.on('PUT', '/obj-1', (_) => FakeResponse(403, err('x')));
    await pumpScreen(t, s);
    await uploadDoc(t, 'National ID', 'Take a photo');
    expect(
      find.text('That file could not be used. Try another photo.'),
      findsOneWidget,
    );
    expect(s.api.to('POST', '/v1/driver/onboarding/documents'), isEmpty);
  });

  testWidgets(
    'submitting early shows the server\'s incomplete message (the button is not the only guard)',
    (t) async {
      final s = DriverServer(initialStatus: 'ONBOARDING');
      // Force the client to think it is complete so the request goes out; the server still says no.
      s.docs.addAll([
        {
          'id': 'd1',
          'document_type_id': 'dt-id',
          'status': 'UPLOADED',
          'vehicle_id': null,
          'review_reason': null,
          'expires_on': null,
        },
        {
          'id': 'd2',
          'document_type_id': 'dt-reg',
          'status': 'UPLOADED',
          'vehicle_id': null,
          'review_reason': null,
          'expires_on': '2099-01-01',
        },
      ]);
      await pumpScreen(t, s);
      s.docs.clear(); // server state changes underneath the screen (e.g. a document was withdrawn)
      final submit = find.widgetWithText(FilledButton, 'Submit for review');
      await t.ensureVisible(submit);
      await t.tap(submit);
      await t.pumpAndSettle();
      expect(
        find.text('Complete every step before submitting.'),
        findsOneWidget,
      );
    },
  );

  testWidgets(
    'NEEDS_CHANGES shows the reviewer\'s reason and lets the driver replace the document',
    (t) async {
      final s = DriverServer(initialStatus: 'NEEDS_CHANGES')
        ..statusReason = 'photo is blurry'
        ..docs.addAll([
          {
            'id': 'd1',
            'document_type_id': 'dt-id',
            'status': 'NEEDS_CHANGES',
            'vehicle_id': null,
            'review_reason': 'photo is blurry',
            'expires_on': null,
          },
          {
            'id': 'd2',
            'document_type_id': 'dt-reg',
            'status': 'APPROVED',
            'vehicle_id': null,
            'review_reason': null,
            'expires_on': '2099-01-01',
          },
        ]);
      await pumpScreen(t, s);
      expect(
        find.text('Changes are needed before we can continue.'),
        findsOneWidget,
      );
      expect(find.text('Reason: photo is blurry'), findsWidgets);
      expect(find.textContaining('Please upload it again'), findsOneWidget);
      final idRow = find.widgetWithText(ListTile, 'National ID');
      expect(
        find.descendant(of: idRow, matching: find.text('Replace')),
        findsOneWidget,
      );
      final regRow = find.widgetWithText(ListTile, 'Vehicle registration');
      expect(
        find.descendant(
          of: regRow,
          matching: find.byType(PopupMenuButton<bool>),
        ),
        findsNothing,
      ); // approved: nothing to replace
    },
  );

  for (final entry in {
    'SUBMITTED': 'Your application is being reviewed.',
    'REJECTED': 'Your application was not approved.',
    'APPROVED':
        'You are approved. Going online will be available in a later update.',
    'SUSPENDED': 'Your driver account is suspended.',
  }.entries) {
    testWidgets(
      '${entry.key}: shows the status, never claims more, and offers no edit or submit',
      (t) async {
        final s = DriverServer(initialStatus: entry.key)
          ..statusReason = entry.key == 'REJECTED' ? 'documents unclear' : null;
        await pumpScreen(t, s);
        expect(find.text(entry.value), findsOneWidget);
        expect(find.widgetWithText(FilledButton, 'Save'), findsNothing);
        expect(
          find.widgetWithText(FilledButton, 'Submit for review'),
          findsNothing,
        );
        if (entry.key == 'REJECTED') {
          expect(find.text('Reason: documents unclear'), findsOneWidget);
        }
      },
    );
  }

  testWidgets('the screen renders in Arabic (right-to-left) and French', (
    t,
  ) async {
    final s = DriverServer();
    await pumpScreen(t, s, locale: const Locale('ar'));
    expect(find.text('كن سائقاً'), findsOneWidget);
    expect(find.text('أكمل الخطوات أدناه ثم أرسل طلبك.'), findsOneWidget);
    expect(
      Directionality.of(t.element(find.text('كن سائقاً'))),
      TextDirection.rtl,
    );
    await pumpScreen(t, DriverServer(), locale: const Locale('fr'));
    expect(find.text('Devenir chauffeur'), findsOneWidget);
  });

  testWidgets('a network failure while loading offers a retry', (t) async {
    final s = DriverServer();
    var fail = true;
    s.api.on(
      'GET',
      '/v1/driver/onboarding/options',
      (_) => fail
          ? throw Exception('offline')
          : FakeResponse(200, DriverServer.options),
    );
    await pumpScreen(t, s);
    expect(
      find.text('No connection. Check your internet and try again.'),
      findsOneWidget,
    );
    fail = false;
    await t.tap(find.text('Try again'));
    await t.pumpAndSettle();
    expect(
      find.text('Complete the steps below, then submit your application.'),
      findsOneWidget,
    );
  });
}
