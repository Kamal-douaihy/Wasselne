import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:flutter_core/flutter_core.dart';

void main() {
  test('ApiConfig defaults to localhost for local development', () {
    expect(ApiConfig.baseUrl, 'http://localhost:3000');
  });

  test('WasselneTheme builds distinct light and dark ThemeData', () {
    final light = WasselneTheme.light();
    final dark = WasselneTheme.dark();
    expect(light.brightness, Brightness.light);
    expect(dark.brightness, Brightness.dark);
    expect(light.colorScheme.primary, isNot(equals(dark.colorScheme.primary)));
  });
}
