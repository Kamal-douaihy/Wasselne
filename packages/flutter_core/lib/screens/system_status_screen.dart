import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api_client.dart';
import '../l10n/generated/app_localizations.dart';

final apiClientProvider = Provider<ApiClient>((ref) => ApiClient());

final healthProvider = FutureProvider<HealthReport>(
  (ref) => ref.watch(apiClientProvider).getHealth(),
);

/// Phase 3 scaffold screen: proves an app built on flutter_core can reach the API, render
/// localized text in the current locale, and pick up the shared theme. Replaced by the real
/// booking / onboarding home screens in later phases.
class SystemStatusScreen extends ConsumerWidget {
  const SystemStatusScreen({super.key, required this.title});

  final String title;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = WasselneLocalizations.of(context);
    final health = ref.watch(healthProvider);

    return Scaffold(
      appBar: AppBar(title: Text(title)),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                l10n.systemStatus,
                style: Theme.of(context).textTheme.titleLarge,
              ),
              const SizedBox(height: 16),
              health.when(
                data: (report) => Column(
                  children: [
                    Icon(
                      report.status == 'ok' ? Icons.check_circle : Icons.error,
                      color: report.status == 'ok' ? Colors.green : Colors.red,
                      size: 40,
                    ),
                    const SizedBox(height: 8),
                    Text(
                      report.status == 'ok'
                          ? l10n.apiReachable
                          : l10n.apiUnreachable,
                    ),
                    Text(
                      'database: ${report.database} · redis: ${report.redis}',
                    ),
                  ],
                ),
                loading: () => Column(
                  children: [
                    const CircularProgressIndicator(),
                    const SizedBox(height: 8),
                    Text(l10n.checking),
                  ],
                ),
                error: (err, _) => Text(
                  '${l10n.apiUnreachable}\n$err',
                  textAlign: TextAlign.center,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
