// Content is checked by its leading bytes, never by the client's declared type alone.
export const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;
export type AllowedType = (typeof ALLOWED_TYPES)[number];

export function matchesMagic(type: string, head: Buffer): boolean {
  switch (type) {
    case "image/jpeg":
      return head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
    case "image/png":
      return head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case "image/webp":
      return head.length >= 12 && head.subarray(0, 4).toString("latin1") === "RIFF" && head.subarray(8, 12).toString("latin1") === "WEBP";
    case "application/pdf":
      return head.length >= 5 && head.subarray(0, 5).toString("latin1") === "%PDF-";
    default:
      return false;
  }
}
