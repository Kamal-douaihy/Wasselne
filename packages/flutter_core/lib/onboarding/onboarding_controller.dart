import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../api/api_client.dart';
import '../api/models.dart';
import '../screens/system_status_screen.dart' show apiClientProvider;
import 'document_picker.dart';

class OnboardingModel {
  const OnboardingModel({
    required this.options,
    this.status,
    this.legal = const [],
  });
  final List<CategoryOption> options;
  final DriverOnboardingStatus?
  status; // null until the profile step has been saved
  final List<LegalDocument> legal;

  OnboardingModel withStatus(DriverOnboardingStatus s) =>
      OnboardingModel(options: options, status: s, legal: legal);
}

/// Loads the application and the CMS options, and performs each step. Every step returns the
/// server's fresh status, so the screen always shows what the server holds, not local guesses.
class OnboardingController extends AsyncNotifier<OnboardingModel> {
  ApiClient get _api => ref.read(apiClientProvider);

  @override
  Future<OnboardingModel> build() async {
    final options = await _api.onboardingOptions();
    final status = await _api.onboardingStatus();
    final legal = await _api.legalCurrent();
    return OnboardingModel(options: options, status: status, legal: legal);
  }

  Future<void> _apply(Future<DriverOnboardingStatus> Function() step) async {
    final current = state.requireValue;
    final next = await step();
    state = AsyncData(current.withStatus(next));
  }

  Future<void> saveProfile({
    required String firstName,
    required String lastName,
    required String gender,
    String? email,
    required List<String> acceptedLegalVersionIds,
  }) => _apply(
    () => _api.saveOnboardingProfile(
      firstName: firstName,
      lastName: lastName,
      gender: gender,
      email: email,
      acceptedLegalVersionIds: acceptedLegalVersionIds,
    ),
  );

  Future<void> saveVehicle({
    required String baseType,
    required String make,
    required String model,
    required String color,
    required String plate,
    required int seats,
    int? year,
  }) => _apply(
    () => _api.saveVehicle(
      baseType: baseType,
      make: make,
      model: model,
      color: color,
      plate: plate,
      seats: seats,
      year: year,
    ),
  );

  Future<void> selectCategories(List<String> ids) =>
      _apply(() => _api.selectCategories(ids));

  Future<void> submit() => _apply(_api.submitOnboarding);

  /// Pick -> authorize -> PUT to storage -> complete -> attach. Any step's failure surfaces as an
  /// [ApiException] (UPLOAD_INVALID for a bad file) and the checklist stays as the server has it.
  Future<void> uploadDocument({
    required RequiredDocument doc,
    required PickedFile file,
    String? expiresOn,
  }) async {
    if (sniffContentType(file.bytes) == null) {
      throw const ApiException(
        statusCode: 400,
        code: 'UPLOAD_INVALID',
        message: 'Unsupported file',
      );
    }
    final grant = await _api.authorizeUpload(
      purpose: 'DRIVER_DOCUMENT',
      contentType: file.contentType,
      maxBytes: file.bytes.length,
    );
    await _api.putToStorage(grant, file.bytes);
    await _api.completeUpload(grant.uploadId);
    await _api.attachDocument(
      documentTypeId: doc.documentTypeId,
      uploadId: grant.uploadId,
      expiresOn: expiresOn,
    );
    final refreshed = await _api.onboardingStatus();
    if (refreshed != null) {
      state = AsyncData(state.requireValue.withStatus(refreshed));
    }
  }

  Future<void> reload() async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(build);
  }
}

final onboardingControllerProvider =
    AsyncNotifierProvider<OnboardingController, OnboardingModel>(
      OnboardingController.new,
    );
