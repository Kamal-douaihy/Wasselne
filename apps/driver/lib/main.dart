import 'package:flutter/material.dart';
import 'package:flutter_core/flutter_core.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

void main() {
  runApp(
    ProviderScope(
      overrides: [appKindProvider.overrideWithValue('DRIVER')],
      child: const WasselneDriverApp(),
    ),
  );
}

class WasselneDriverApp extends StatelessWidget {
  const WasselneDriverApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      onGenerateTitle: (context) =>
          WasselneLocalizations.of(context).appTitleDriver,
      theme: WasselneTheme.light(),
      darkTheme: WasselneTheme.dark(),
      localizationsDelegates: WasselneLocalizations.localizationsDelegates,
      supportedLocales: WasselneLocalizations.supportedLocales,
      home: SignInFlow(
        signedIn: (context, profile) =>
            DriverOnboardingScreen(profile: profile),
      ),
    );
  }
}
