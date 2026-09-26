import 'package:flutter_core/flutter_core.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('content type comes from the bytes, not from names', () {
    expect(sniffContentType([0xff, 0xd8, 0xff, 0xe0, 0]), 'image/jpeg');
    expect(
      sniffContentType([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]),
      'image/png',
    );
    expect(
      sniffContentType([...'RIFF'.codeUnits, 0, 0, 0, 0, ...'WEBP'.codeUnits]),
      'image/webp',
    );
    expect(sniffContentType('%PDF-1.7'.codeUnits), 'application/pdf');
  });

  test('anything else is refused', () {
    expect(sniffContentType('MZ\x90'.codeUnits), isNull);
    expect(sniffContentType('<html>'.codeUnits), isNull);
    expect(sniffContentType([]), isNull);
    expect(sniffContentType([0xff, 0xd8]), isNull); // truncated header
  });
}
