import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api_client.dart';
import '../api/models.dart';
import '../auth/auth_controller.dart';
import '../l10n/generated/app_localizations.dart';
import 'document_picker.dart';
import 'onboarding_controller.dart';

String onboardingErrorText(WasselneLocalizations l10n, Object e) {
  if (e is ApiException) {
    switch (e.code) {
      case 'CATEGORY_NOT_ELIGIBLE':
        return _categoryReason(l10n, e);
      case 'ONBOARDING_INCOMPLETE':
        return l10n.errorOnboardingIncomplete;
      case 'UPLOAD_INVALID':
        return l10n.errorUploadInvalid;
      case 'INVALID_STATE':
        return l10n.errorInvalidState;
      case 'TERMS_ACCEPTANCE_REQUIRED':
        return l10n.errorTerms;
      case 'ACCOUNT_BLOCKED':
        return l10n.errorBlocked;
    }
    return l10n.errorGeneric(e.correlationId ?? '-');
  }
  if (e is DioException) return l10n.errorNetwork;
  return l10n.errorGeneric('-');
}

String _categoryReason(WasselneLocalizations l10n, ApiException e) =>
    switch (e.reason) {
      'SEATS' => l10n.errCatSeats,
      'VEHICLE_YEAR' => l10n.errCatYear,
      'WOMEN_ONLY' => l10n.errCatWomenOnly,
      _ => l10n.errCatVehicleType,
    };

/// The driver's application: profile, vehicle, categories, documents, submit, and the review
/// status afterwards. Reads and writes only through the server; nothing is decided locally.
class DriverOnboardingScreen extends ConsumerWidget {
  const DriverOnboardingScreen({super.key, required this.profile});
  final Profile profile;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = WasselneLocalizations.of(context);
    final model = ref.watch(onboardingControllerProvider);
    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.onboardingTitle),
        actions: [
          TextButton(
            onPressed: () =>
                ref.read(authControllerProvider.notifier).signOut(),
            child: Text(l10n.signOut),
          ),
        ],
      ),
      body: model.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(onboardingErrorText(l10n, e)),
              TextButton(
                onPressed: () =>
                    ref.read(onboardingControllerProvider.notifier).reload(),
                child: Text(l10n.retry),
              ),
            ],
          ),
        ),
        data: (m) => _Body(model: m, profile: profile),
      ),
    );
  }
}

class _Body extends ConsumerStatefulWidget {
  const _Body({required this.model, required this.profile});
  final OnboardingModel model;
  final Profile profile;
  @override
  ConsumerState<_Body> createState() => _BodyState();
}

class _BodyState extends ConsumerState<_Body> {
  String? _error;
  bool _busy = false;

  Future<void> _run(Future<void> Function() step) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await step();
    } catch (e) {
      if (mounted) {
        setState(
          () => _error = onboardingErrorText(
            WasselneLocalizations.of(context),
            e,
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = WasselneLocalizations.of(context);
    final status = widget.model.status;
    final editable = status == null || status.editable;
    final statusText = switch (status?.status) {
      null || 'ONBOARDING' => l10n.statusOnboarding,
      'SUBMITTED' => l10n.statusSubmitted,
      'NEEDS_CHANGES' => l10n.statusNeedsChanges,
      'REJECTED' => l10n.statusRejected,
      'APPROVED' => l10n.statusApproved,
      'SUSPENDED' => l10n.statusSuspended,
      _ => '',
    };
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Card(
          color: Theme.of(context).colorScheme.primaryContainer,
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  statusText,
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                if (status?.statusReason != null)
                  Text(l10n.reasonLabel(status!.statusReason!)),
              ],
            ),
          ),
        ),
        if (_error != null)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 8),
            child: Text(
              _error!,
              style: TextStyle(color: Theme.of(context).colorScheme.error),
              semanticsLabel: _error,
            ),
          ),
        if (editable) ...[
          _Section(
            title: l10n.stepProfile,
            done: status?.checklist.profile ?? false,
            child: _ProfileStep(
              model: widget.model,
              profile: widget.profile,
              busy: _busy,
              run: _run,
            ),
          ),
          _Section(
            title: l10n.stepVehicle,
            done: status?.checklist.vehicle ?? false,
            child: _VehicleStep(
              busy: _busy,
              run: _run,
              enabled: status != null,
            ),
          ),
          _Section(
            title: l10n.stepCategories,
            done: status?.checklist.categories ?? false,
            child: _CategoriesStep(
              model: widget.model,
              profile: widget.profile,
              busy: _busy,
              run: _run,
            ),
          ),
          _Section(
            title: l10n.stepDocuments,
            done: status?.checklist.documentsComplete ?? false,
            child: _DocumentsStep(model: widget.model, busy: _busy, run: _run),
          ),
          const SizedBox(height: 16),
          FilledButton(
            onPressed: _busy || status == null || !status.checklist.complete
                ? null
                : () => _run(
                    () => ref
                        .read(onboardingControllerProvider.notifier)
                        .submit(),
                  ),
            child: Text(l10n.submitApplication),
          ),
        ] else if (status.documents.isNotEmpty)
          _Section(
            title: l10n.stepDocuments,
            done: status.checklist.documentsComplete,
            child: _DocumentsStep(model: widget.model, busy: true, run: _run),
          ),
      ],
    );
  }
}

class _Section extends StatelessWidget {
  const _Section({
    required this.title,
    required this.done,
    required this.child,
  });
  final String title;
  final bool done;
  final Widget child;

  @override
  Widget build(BuildContext context) => Card(
    child: ExpansionTile(
      initiallyExpanded: !done,
      leading: Icon(
        done ? Icons.check_circle : Icons.radio_button_unchecked,
        color: done ? Colors.green : null,
      ),
      title: Text(title),
      childrenPadding: const EdgeInsets.all(16),
      children: [child],
    ),
  );
}

typedef _Run = Future<void> Function(Future<void> Function() step);

class _ProfileStep extends ConsumerStatefulWidget {
  const _ProfileStep({
    required this.model,
    required this.profile,
    required this.busy,
    required this.run,
  });
  final OnboardingModel model;
  final Profile profile;
  final bool busy;
  final _Run run;
  @override
  ConsumerState<_ProfileStep> createState() => _ProfileStepState();
}

class _ProfileStepState extends ConsumerState<_ProfileStep> {
  late final _first = TextEditingController(
    text: widget.profile.firstName ?? '',
  );
  late final _last = TextEditingController(text: widget.profile.lastName ?? '');
  late String? _gender = widget.profile.gender;
  final Set<String> _accepted = {};

  @override
  void dispose() {
    _first.dispose();
    _last.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = WasselneLocalizations.of(context);
    final legal = widget.model.legal;
    final ok =
        _first.text.trim().isNotEmpty &&
        _last.text.trim().isNotEmpty &&
        _gender != null &&
        legal.every((d) => _accepted.contains(d.id));
    return Column(
      children: [
        TextField(
          controller: _first,
          decoration: InputDecoration(labelText: l10n.firstName),
          onChanged: (_) => setState(() {}),
        ),
        TextField(
          controller: _last,
          decoration: InputDecoration(labelText: l10n.lastName),
          onChanged: (_) => setState(() {}),
        ),
        RadioGroup<String>(
          groupValue: _gender,
          onChanged: (v) => setState(() => _gender = v),
          child: Column(
            children: [
              RadioListTile<String>(value: 'FEMALE', title: Text(l10n.female)),
              RadioListTile<String>(value: 'MALE', title: Text(l10n.male)),
            ],
          ),
        ),
        Align(
          alignment: AlignmentDirectional.centerStart,
          child: Text(
            l10n.genderNote,
            style: Theme.of(context).textTheme.bodySmall,
          ),
        ),
        for (final d in legal)
          CheckboxListTile(
            controlAffinity: ListTileControlAffinity.leading,
            value: _accepted.contains(d.id),
            onChanged: (v) => setState(
              () => v == true ? _accepted.add(d.id) : _accepted.remove(d.id),
            ),
            title: Text(l10n.acceptTerms(d.title)),
          ),
        Align(
          alignment: AlignmentDirectional.centerEnd,
          child: FilledButton(
            onPressed: widget.busy || !ok
                ? null
                : () => widget.run(
                    () => ref
                        .read(onboardingControllerProvider.notifier)
                        .saveProfile(
                          firstName: _first.text.trim(),
                          lastName: _last.text.trim(),
                          gender: _gender!,
                          acceptedLegalVersionIds: legal
                              .map((d) => d.id)
                              .toList(),
                        ),
                  ),
            child: Text(l10n.save),
          ),
        ),
      ],
    );
  }
}

class _VehicleStep extends ConsumerStatefulWidget {
  const _VehicleStep({
    required this.busy,
    required this.run,
    required this.enabled,
  });
  final bool busy;
  final bool enabled;
  final _Run run;
  @override
  ConsumerState<_VehicleStep> createState() => _VehicleStepState();
}

class _VehicleStepState extends ConsumerState<_VehicleStep> {
  String _type = 'CAR';
  final _make = TextEditingController();
  final _model = TextEditingController();
  final _year = TextEditingController();
  final _color = TextEditingController();
  final _plate = TextEditingController();
  final _seats = TextEditingController(text: '4');

  @override
  void dispose() {
    for (final c in [_make, _model, _year, _color, _plate, _seats]) {
      c.dispose();
    }
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = WasselneLocalizations.of(context);
    final seats = int.tryParse(_seats.text);
    final ok =
        widget.enabled &&
        _make.text.trim().isNotEmpty &&
        _model.text.trim().isNotEmpty &&
        _color.text.trim().isNotEmpty &&
        _plate.text.trim().isNotEmpty &&
        seats != null &&
        seats > 0;
    return Column(
      children: [
        DropdownButtonFormField<String>(
          initialValue: _type,
          decoration: InputDecoration(labelText: l10n.vehicleType),
          items: [
            DropdownMenuItem(value: 'CAR', child: Text(l10n.typeCar)),
            DropdownMenuItem(
              value: 'MOTORCYCLE',
              child: Text(l10n.typeMotorcycle),
            ),
            DropdownMenuItem(value: 'TUKTUK', child: Text(l10n.typeTuktuk)),
          ],
          onChanged: (v) => setState(() => _type = v ?? 'CAR'),
        ),
        TextField(
          controller: _make,
          decoration: InputDecoration(labelText: l10n.vehicleMake),
          onChanged: (_) => setState(() {}),
        ),
        TextField(
          controller: _model,
          decoration: InputDecoration(labelText: l10n.vehicleModel),
          onChanged: (_) => setState(() {}),
        ),
        TextField(
          controller: _year,
          keyboardType: TextInputType.number,
          decoration: InputDecoration(labelText: l10n.vehicleYear),
        ),
        TextField(
          controller: _color,
          decoration: InputDecoration(labelText: l10n.vehicleColor),
          onChanged: (_) => setState(() {}),
        ),
        TextField(
          controller: _plate,
          textDirection: TextDirection.ltr,
          decoration: InputDecoration(labelText: l10n.vehiclePlate),
          onChanged: (_) => setState(() {}),
        ),
        TextField(
          controller: _seats,
          keyboardType: TextInputType.number,
          decoration: InputDecoration(labelText: l10n.vehicleSeats),
          onChanged: (_) => setState(() {}),
        ),
        Align(
          alignment: AlignmentDirectional.centerEnd,
          child: FilledButton(
            onPressed: widget.busy || !ok
                ? null
                : () => widget.run(
                    () => ref
                        .read(onboardingControllerProvider.notifier)
                        .saveVehicle(
                          baseType: _type,
                          make: _make.text.trim(),
                          model: _model.text.trim(),
                          color: _color.text.trim(),
                          plate: _plate.text.trim(),
                          seats: seats,
                          year: int.tryParse(_year.text),
                        ),
                  ),
            child: Text(l10n.save),
          ),
        ),
      ],
    );
  }
}

class _CategoriesStep extends ConsumerStatefulWidget {
  const _CategoriesStep({
    required this.model,
    required this.profile,
    required this.busy,
    required this.run,
  });
  final OnboardingModel model;
  final Profile profile;
  final bool busy;
  final _Run run;
  @override
  ConsumerState<_CategoriesStep> createState() => _CategoriesStepState();
}

class _CategoriesStepState extends ConsumerState<_CategoriesStep> {
  final Set<String> _picked = {};

  @override
  Widget build(BuildContext context) {
    final l10n = WasselneLocalizations.of(context);
    final locale = Localizations.localeOf(context);
    return Column(
      children: [
        for (final c in widget.model.options)
          CheckboxListTile(
            controlAffinity: ListTileControlAffinity.leading,
            value: _picked.contains(c.id),
            onChanged: (v) => setState(
              () => v == true ? _picked.add(c.id) : _picked.remove(c.id),
            ),
            title: Text(c.names.of(locale)),
            subtitle: c.femaleDriversOnly ? Text(l10n.categoryWomenOnly) : null,
          ),
        Align(
          alignment: AlignmentDirectional.centerEnd,
          child: FilledButton(
            onPressed:
                widget.busy || _picked.isEmpty || widget.model.status == null
                ? null
                : () => widget.run(
                    () => ref
                        .read(onboardingControllerProvider.notifier)
                        .selectCategories(_picked.toList()),
                  ),
            child: Text(l10n.save),
          ),
        ),
      ],
    );
  }
}

class _DocumentsStep extends ConsumerWidget {
  const _DocumentsStep({
    required this.model,
    required this.busy,
    required this.run,
  });
  final OnboardingModel model;
  final bool busy;
  final _Run run;

  String _statusText(WasselneLocalizations l10n, String? s) => switch (s) {
    null => l10n.docMissing,
    'UPLOADED' => l10n.docUploaded,
    'APPROVED' => l10n.docApproved,
    'NEEDS_CHANGES' => l10n.docNeedsChanges,
    'REJECTED' => l10n.docRejected,
    'EXPIRED' => l10n.docExpired,
    _ => s,
  };

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = WasselneLocalizations.of(context);
    final locale = Localizations.localeOf(context);
    final status = model.status;
    // Required documents: the union over the categories the driver applied for (rejected ones no
    // longer count). The server's checklist totals stay the authority for "complete".
    final applied = status == null
        ? const <String>{}
        : {
            for (final c in status.categories)
              if (c.status != 'REJECTED') c.categoryId,
          };
    final required = <String, RequiredDocument>{};
    for (final c in model.options.where((c) => applied.contains(c.id))) {
      for (final d in c.requiredDocuments) {
        required[d.documentTypeId] = d;
      }
    }
    final shown = required.values.toList();
    if (shown.isEmpty) return const SizedBox.shrink();
    return Column(
      children: [
        for (final d in shown)
          Builder(
            builder: (context) {
              final current = status?.documents
                  .where((x) => x.documentTypeId == d.documentTypeId)
                  .firstOrNull;
              return ListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(d.names.of(locale)),
                subtitle: Text(
                  [
                    _statusText(l10n, current?.status),
                    if (current?.reviewReason != null)
                      l10n.reasonLabel(current!.reviewReason!),
                  ].join(' · '),
                ),
                trailing:
                    status != null &&
                        status.editable &&
                        current?.status != 'APPROVED'
                    ? PopupMenuButton<bool>(
                        enabled: !busy,
                        tooltip: l10n.uploadDocument,
                        onSelected: (camera) =>
                            run(() => _upload(context, ref, d, camera)),
                        itemBuilder: (_) => [
                          PopupMenuItem(
                            value: true,
                            child: Text(l10n.takePhoto),
                          ),
                          if (d.allowGallery)
                            PopupMenuItem(
                              value: false,
                              child: Text(l10n.chooseFromGallery),
                            ),
                        ],
                        child: Padding(
                          padding: const EdgeInsets.all(8),
                          child: Text(
                            current == null
                                ? l10n.uploadDocument
                                : l10n.replaceDocument,
                          ),
                        ),
                      )
                    : null,
              );
            },
          ),
      ],
    );
  }

  Future<void> _upload(
    BuildContext context,
    WidgetRef ref,
    RequiredDocument d,
    bool camera,
  ) async {
    final l10n = WasselneLocalizations.of(context);
    String? expiresOn;
    if (d.hasExpiry) {
      final now = DateTime.now();
      final picked = await showDatePicker(
        context: context,
        helpText: l10n.chooseExpiry,
        initialDate: now.add(const Duration(days: 365)),
        firstDate: now,
        lastDate: now.add(const Duration(days: 365 * 30)),
      );
      if (picked == null) return;
      expiresOn =
          '${picked.year.toString().padLeft(4, '0')}-${picked.month.toString().padLeft(2, '0')}-${picked.day.toString().padLeft(2, '0')}';
    }
    final file = await ref.read(documentPickerProvider).pick(camera: camera);
    if (file == null) return;
    await ref
        .read(onboardingControllerProvider.notifier)
        .uploadDocument(doc: d, file: file, expiresOn: expiresOn);
  }
}
