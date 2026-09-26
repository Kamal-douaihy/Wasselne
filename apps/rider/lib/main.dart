import 'package:flutter/material.dart';
import 'package:flutter_core/flutter_core.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

void main() {
  runApp(
    ProviderScope(
      overrides: [appKindProvider.overrideWithValue('RIDER')],
      child: const WasselneRiderApp(),
    ),
  );
}

class WasselneRiderApp extends StatelessWidget {
  const WasselneRiderApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      onGenerateTitle: (context) =>
          WasselneLocalizations.of(context).appTitleRider,
      theme: WasselneTheme.light(),
      darkTheme: WasselneTheme.dark(),
      localizationsDelegates: WasselneLocalizations.localizationsDelegates,
      supportedLocales: WasselneLocalizations.supportedLocales,
      home: SignInFlow(
        signedIn: (context, profile) => RiderHome(profile: profile),
      ),
    );
  }
}

/// Phase 4 rider home: proves sign-in and profile work end to end. Booking, maps and trips
/// arrive in Phases 5-7, so this says plainly that booking is not available yet.
class RiderHome extends ConsumerWidget {
  const RiderHome({super.key, required this.profile});

  final Profile profile;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = WasselneLocalizations.of(context);
    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.appTitleRider),
        actions: [
          TextButton(
            onPressed: () =>
                ref.read(authControllerProvider.notifier).signOut(),
            child: Text(l10n.signOut),
          ),
        ],
      ),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              l10n.riderHomeGreeting(profile.displayName),
              style: Theme.of(context).textTheme.headlineSmall,
            ),
            const SizedBox(height: 12),
            Text(l10n.riderHomeNote),
          ],
        ),
      ),
    );
  }
}
