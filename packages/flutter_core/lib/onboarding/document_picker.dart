import 'dart:typed_data';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

class PickedFile {
  const PickedFile(this.bytes, this.contentType);
  final Uint8List bytes;
  final String contentType;
}

/// The content type is decided from the file's leading bytes, never from its name or the picker's
/// guess, so what the app declares matches what the server will check. Null = not an accepted type.
String? sniffContentType(List<int> b) {
  bool starts(List<int> p, [int at = 0]) {
    if (b.length < at + p.length) return false;
    for (var i = 0; i < p.length; i++) {
      if (b[at + i] != p[i]) return false;
    }
    return true;
  }

  if (starts([0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'image/png';
  }
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) {
    return 'image/webp';
  }
  if (starts([0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf';
  return null;
}

abstract class DocumentPicker {
  /// Camera when [camera] is true, otherwise the gallery. Null when the person cancels.
  Future<PickedFile?> pick({required bool camera});
}

class ImagePickerDocumentPicker implements DocumentPicker {
  final ImagePicker _picker = ImagePicker();

  @override
  Future<PickedFile?> pick({required bool camera}) async {
    final file = await _picker.pickImage(
      source: camera ? ImageSource.camera : ImageSource.gallery,
      maxWidth: 2400,
      imageQuality: 88,
    );
    if (file == null) return null;
    final bytes = await file.readAsBytes();
    final type = sniffContentType(bytes);
    return type == null
        ? PickedFile(bytes, 'application/octet-stream')
        : PickedFile(bytes, type);
  }
}

/// Overridden in tests; on a device this is the platform image picker.
final documentPickerProvider = Provider<DocumentPicker>(
  (ref) => ImagePickerDocumentPicker(),
);
