import 'package:flutter/material.dart';

import 'tokens.g.dart';

/// Builds Flutter ThemeData from the Phase 1 design tokens (docs/phase-1/design-tokens.json),
/// generated into tokens.g.dart by packages/design-tokens. Both rider and driver apps use this
/// so a token change never needs a per-app edit.
class WasselneTheme {
  const WasselneTheme._();

  static ThemeData light() => _themeFrom(
    brightness: Brightness.light,
    background: WasselneLightColors.background,
    surface: WasselneLightColors.surface,
    primary: WasselneLightColors.primary,
    onPrimary: WasselneLightColors.onPrimary,
    secondary: WasselneLightColors.accent,
    onSecondary: WasselneLightColors.onAccent,
    error: WasselneLightColors.danger,
    onError: WasselneLightColors.onDanger,
    onSurface: WasselneLightColors.textPrimary,
  );

  static ThemeData dark() => _themeFrom(
    brightness: Brightness.dark,
    background: WasselneDarkColors.background,
    surface: WasselneDarkColors.surface,
    primary: WasselneDarkColors.primary,
    onPrimary: WasselneDarkColors.onPrimary,
    secondary: WasselneDarkColors.accent,
    onSecondary: WasselneDarkColors.onAccent,
    error: WasselneDarkColors.danger,
    onError: WasselneDarkColors.onDanger,
    onSurface: WasselneDarkColors.textPrimary,
  );

  static ThemeData _themeFrom({
    required Brightness brightness,
    required Color background,
    required Color surface,
    required Color primary,
    required Color onPrimary,
    required Color secondary,
    required Color onSecondary,
    required Color error,
    required Color onError,
    required Color onSurface,
  }) {
    final colorScheme = ColorScheme(
      brightness: brightness,
      primary: primary,
      onPrimary: onPrimary,
      secondary: secondary,
      onSecondary: onSecondary,
      error: error,
      onError: onError,
      surface: surface,
      onSurface: onSurface,
    );
    return ThemeData(
      useMaterial3: true,
      colorScheme: colorScheme,
      scaffoldBackgroundColor: background,
      visualDensity: VisualDensity.adaptivePlatformDensity,
    );
  }
}
