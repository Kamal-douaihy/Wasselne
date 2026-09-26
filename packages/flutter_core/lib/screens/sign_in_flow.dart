import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/models.dart';
import '../auth/auth_controller.dart';
import '../l10n/generated/app_localizations.dart';
import '../screens/system_status_screen.dart' show apiClientProvider;

String authErrorText(WasselneLocalizations l10n, AuthFailure f) {
  switch (f.kind) {
    case AuthFailureKind.network:
      return l10n.errorNetwork;
    case AuthFailureKind.otpInvalid:
      return l10n.errorOtpInvalid;
    case AuthFailureKind.otpExpired:
      return l10n.errorOtpExpired;
    case AuthFailureKind.rateLimited:
      return l10n.errorRateLimited(f.retryAfterSeconds ?? 60);
    case AuthFailureKind.blocked:
      return l10n.errorBlocked;
    case AuthFailureKind.termsRequired:
      return l10n.errorTerms;
    case AuthFailureKind.generic:
      return l10n.errorGeneric(f.reference ?? '-');
  }
}

/// Sign-in for either app. Shows the right step for the current phase and hands over to
/// [signedIn] once there is a session.
class SignInFlow extends ConsumerWidget {
  const SignInFlow({super.key, required this.signedIn});

  final Widget Function(BuildContext context, Profile profile) signedIn;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authControllerProvider);
    switch (auth.phase) {
      case AuthPhase.restoring:
        return const Scaffold(body: Center(child: CircularProgressIndicator()));
      case AuthPhase.signedOut:
        return const PhoneScreen();
      case AuthPhase.awaitingCode:
        return const CodeScreen();
      case AuthPhase.needsProfile:
        return const ProfileScreen();
      case AuthPhase.signedIn:
        return signedIn(context, auth.profile!);
    }
  }
}

class _FailureText extends StatelessWidget {
  const _FailureText(this.failure);
  final AuthFailure? failure;

  @override
  Widget build(BuildContext context) {
    if (failure == null) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: Text(
        authErrorText(WasselneLocalizations.of(context), failure!),
        style: TextStyle(color: Theme.of(context).colorScheme.error),
        semanticsLabel: authErrorText(
          WasselneLocalizations.of(context),
          failure!,
        ),
      ),
    );
  }
}

class PhoneScreen extends ConsumerStatefulWidget {
  const PhoneScreen({super.key});
  @override
  ConsumerState<PhoneScreen> createState() => _PhoneScreenState();
}

class _PhoneScreenState extends ConsumerState<PhoneScreen> {
  final _controller = TextEditingController();
  final _form = GlobalKey<FormState>();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = WasselneLocalizations.of(context);
    final auth = ref.watch(authControllerProvider);
    return Scaffold(
      appBar: AppBar(title: Text(l10n.phoneTitle)),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Form(
          key: _form,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              TextFormField(
                controller: _controller,
                keyboardType: TextInputType.phone,
                textDirection: TextDirection.ltr,
                autofillHints: const [AutofillHints.telephoneNumber],
                decoration: InputDecoration(
                  labelText: l10n.phoneLabel,
                  helperText: l10n.phoneHelp,
                ),
                validator: (v) =>
                    AuthController.isValidPhone(
                      (v ?? '').replaceAll(RegExp(r'[\s-]'), ''),
                    )
                    ? null
                    : l10n.phoneInvalid,
              ),
              const SizedBox(height: 16),
              FilledButton(
                onPressed: auth.busy
                    ? null
                    : () {
                        if (_form.currentState!.validate()) {
                          ref
                              .read(authControllerProvider.notifier)
                              .submitPhone(_controller.text);
                        }
                      },
                child: auth.busy ? const _Spinner() : Text(l10n.sendCode),
              ),
              _FailureText(auth.failure),
            ],
          ),
        ),
      ),
    );
  }
}

class _Spinner extends StatelessWidget {
  const _Spinner();
  @override
  Widget build(BuildContext context) => const SizedBox(
    width: 20,
    height: 20,
    child: CircularProgressIndicator(strokeWidth: 2),
  );
}

class CodeScreen extends ConsumerStatefulWidget {
  const CodeScreen({super.key});
  @override
  ConsumerState<CodeScreen> createState() => _CodeScreenState();
}

class _CodeScreenState extends ConsumerState<CodeScreen> {
  final _controller = TextEditingController();
  Timer? _ticker;
  int _wait = 0;

  @override
  void initState() {
    super.initState();
    _startTicker();
  }

  // The resend countdown follows the server's resend_after, not a local guess.
  void _startTicker() {
    _ticker?.cancel();
    void update() {
      final at = ref.read(authControllerProvider).challenge?.resendAfter;
      final left = at == null ? 0 : at.difference(DateTime.now()).inSeconds + 1;
      if (mounted) setState(() => _wait = left < 0 ? 0 : left);
    }

    update();
    _ticker = Timer.periodic(const Duration(seconds: 1), (_) => update());
  }

  @override
  void dispose() {
    _ticker?.cancel();
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = WasselneLocalizations.of(context);
    final auth = ref.watch(authControllerProvider);
    ref.listen(
      authControllerProvider.select((s) => s.challenge?.challengeId),
      (_, _) => _startTicker(),
    );
    return Scaffold(
      appBar: AppBar(title: Text(l10n.codeTitle)),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(l10n.codeSent(auth.phone ?? '')),
            const SizedBox(height: 16),
            TextField(
              controller: _controller,
              keyboardType: TextInputType.number,
              textDirection: TextDirection.ltr,
              maxLength: 8,
              onChanged: (_) => setState(
                () {},
              ), // enables Verify once a plausible code is typed
              autofillHints: const [AutofillHints.oneTimeCode],
              decoration: InputDecoration(labelText: l10n.codeLabel),
            ),
            FilledButton(
              onPressed: auth.busy || _controller.text.trim().length < 4
                  ? null
                  : () => ref
                        .read(authControllerProvider.notifier)
                        .submitCode(_controller.text),
              child: auth.busy ? const _Spinner() : Text(l10n.verify),
            ),
            _FailureText(auth.failure),
            const SizedBox(height: 16),
            TextButton(
              onPressed: _wait > 0 || auth.busy
                  ? null
                  : () => ref.read(authControllerProvider.notifier).resend(),
              child: Text(_wait > 0 ? l10n.resendIn(_wait) : l10n.resendCode),
            ),
            TextButton(
              onPressed: () =>
                  ref.read(authControllerProvider.notifier).changeNumber(),
              child: Text(l10n.changeNumber),
            ),
          ],
        ),
      ),
    );
  }
}

/// Terms shown to a new account before it exists, keyed by (token, language).
final signUpLegalProvider =
    FutureProvider.family<List<LegalDocument>, (String, String)>(
      (ref, key) => ref
          .watch(apiClientProvider)
          .legalForSignUp(needsProfileToken: key.$1, language: key.$2),
    );

class ProfileScreen extends ConsumerStatefulWidget {
  const ProfileScreen({super.key});
  @override
  ConsumerState<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends ConsumerState<ProfileScreen> {
  final _form = GlobalKey<FormState>();
  final _first = TextEditingController();
  final _last = TextEditingController();
  final _email = TextEditingController();
  String? _gender;
  bool _genderMissing = false;
  final Set<String> _accepted = {};

  @override
  void dispose() {
    _first.dispose();
    _last.dispose();
    _email.dispose();
    super.dispose();
  }

  String _language(BuildContext context) {
    final code = Localizations.localeOf(context).languageCode;
    return const ['ar', 'en', 'fr'].contains(code) ? code : 'en';
  }

  @override
  Widget build(BuildContext context) {
    final l10n = WasselneLocalizations.of(context);
    final auth = ref.watch(authControllerProvider);
    final lang = _language(context);
    final legal = ref.watch(
      signUpLegalProvider((auth.needsProfileToken!, lang)),
    );
    final docs = legal.valueOrNull ?? const <LegalDocument>[];
    final termsOk = docs.every((d) => _accepted.contains(d.id));

    String? required(String? v) =>
        (v == null || v.trim().isEmpty) ? l10n.fieldRequired : null;

    return Scaffold(
      appBar: AppBar(title: Text(l10n.profileTitle)),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: Form(
          key: _form,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              TextFormField(
                controller: _first,
                decoration: InputDecoration(labelText: l10n.firstName),
                validator: required,
              ),
              TextFormField(
                controller: _last,
                decoration: InputDecoration(labelText: l10n.lastName),
                validator: required,
              ),
              TextFormField(
                controller: _email,
                keyboardType: TextInputType.emailAddress,
                decoration: InputDecoration(labelText: l10n.emailOptional),
              ),
              const SizedBox(height: 16),
              Text(
                l10n.genderLabel,
                style: Theme.of(context).textTheme.titleSmall,
              ),
              RadioGroup<String>(
                groupValue: _gender,
                onChanged: (v) => setState(() {
                  _gender = v;
                  _genderMissing = false;
                }),
                child: Column(
                  children: [
                    RadioListTile<String>(
                      value: 'FEMALE',
                      title: Text(l10n.female),
                    ),
                    RadioListTile<String>(
                      value: 'MALE',
                      title: Text(l10n.male),
                    ),
                  ],
                ),
              ),
              if (_genderMissing)
                Text(
                  l10n.fieldRequired,
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              Text(
                l10n.genderNote,
                style: Theme.of(context).textTheme.bodySmall,
              ),
              if (docs.isNotEmpty) ...[
                const SizedBox(height: 16),
                Text(
                  l10n.termsTitle,
                  style: Theme.of(context).textTheme.titleSmall,
                ),
                for (final d in docs)
                  CheckboxListTile(
                    controlAffinity: ListTileControlAffinity.leading,
                    value: _accepted.contains(d.id),
                    onChanged: (v) => setState(
                      () => v == true
                          ? _accepted.add(d.id)
                          : _accepted.remove(d.id),
                    ),
                    title: Text(l10n.acceptTerms(d.title)),
                  ),
              ],
              if (legal.hasError)
                Padding(
                  padding: const EdgeInsets.only(top: 8),
                  child: Text(l10n.errorNetwork),
                ),
              const SizedBox(height: 16),
              FilledButton(
                onPressed:
                    auth.busy || legal.isLoading || legal.hasError || !termsOk
                    ? null
                    : () {
                        final valid = _form.currentState!.validate();
                        if (_gender == null) {
                          setState(() => _genderMissing = true);
                        }
                        if (!valid || _gender == null) return;
                        ref
                            .read(authControllerProvider.notifier)
                            .completeProfile(
                              firstName: _first.text.trim(),
                              lastName: _last.text.trim(),
                              gender: _gender!,
                              email: _email.text.trim().isEmpty
                                  ? null
                                  : _email.text.trim(),
                              language: lang,
                              acceptedLegalVersionIds: docs
                                  .map((d) => d.id)
                                  .toList(),
                            );
                      },
                child: auth.busy ? const _Spinner() : Text(l10n.continueLabel),
              ),
              _FailureText(auth.failure),
            ],
          ),
        ),
      ),
    );
  }
}
