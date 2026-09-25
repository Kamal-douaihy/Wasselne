/// Base URL for the Wasselne API. Overridable per build with:
///   flutter run --dart-define=WASSELNE_API_BASE_URL=http://10.0.2.2:3000
/// (10.0.2.2 is the Android emulator's alias for the host machine's localhost.)
class ApiConfig {
  const ApiConfig._();

  static const String baseUrl = String.fromEnvironment(
    "WASSELNE_API_BASE_URL",
    defaultValue: "http://localhost:3000",
  );
}
