import 'package:flutter/material.dart';
import 'package:flutter_core/flutter_core.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

void main() {
  runApp(const ProviderScope(child: WasselneRiderApp()));
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
      home: Builder(
        builder: (context) => SystemStatusScreen(
          title: WasselneLocalizations.of(context).appTitleRider,
        ),
      ),
    );
  }
}
