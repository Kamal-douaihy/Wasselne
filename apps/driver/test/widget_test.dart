import 'package:flutter_core/flutter_core.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:driver/main.dart';

void main() {
  testWidgets(
    'renders the localized driver app title and the API status once loaded',
    (tester) async {
      // Overriding healthProvider keeps this a widget test, not an integration test that depends
      // on a live API process; the real end-to-end call is exercised by the Phase 3 smoke test.
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            healthProvider.overrideWith(
              (ref) async =>
                  const HealthReport(status: 'ok', database: 'ok', redis: 'ok'),
            ),
          ],
          child: const WasselneDriverApp(),
        ),
      );
      await tester.pump();
      expect(find.text('Wasselne Driver'), findsWidgets);

      await tester.pumpAndSettle();
      expect(find.text('API reachable'), findsOneWidget);
    },
  );
}
