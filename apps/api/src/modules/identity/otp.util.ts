import { createHash, randomBytes, randomInt, scryptSync, timingSafeEqual } from "node:crypto";

export function generateOtpCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

// otp_challenges.code_hash stores "salt:derivedKey" (hex). scrypt is deliberately slow so a
// leaked table can't be brute-forced offline despite the code's low (6-digit) entropy.
export function hashOtpCode(code: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(code, salt, 32);
  return `${salt.toString("hex")}:${derived.toString("hex")}`;
}

export function verifyOtpCode(code: string, stored: string): boolean {
  const [saltHex, keyHex] = stored.split(":");
  if (!saltHex || !keyHex) return false;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(keyHex, "hex");
  const actual = scryptSync(code, salt, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function generateRefreshToken(): string {
  return randomBytes(32).toString("hex");
}

// Refresh tokens are 256 bits of random entropy, not guessable input like an OTP code, so a
// fast keyless digest (rather than scrypt) is enough to avoid storing the raw secret at rest.
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
