import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";

// argon2id (the @node-rs default algorithm is argon2id). Parameters follow the OWASP minimum
// profile; tune against real hardware before launch (register TBD-4-04).
export const hashPassword = (password: string): Promise<string> => hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
export const verifyPassword = (stored: string, password: string): Promise<boolean> => verify(stored, password).catch(() => false);

/** AES-256-GCM: iv(12) | tag(16) | ciphertext. Used for TOTP secrets at rest. */
export function encryptSecret(plain: string, keyHex: string): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", Buffer.from(keyHex, "hex"), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]);
}

export function decryptSecret(blob: Buffer, keyHex: string): string {
  const d = createDecipheriv("aes-256-gcm", Buffer.from(keyHex, "hex"), blob.subarray(0, 12));
  d.setAuthTag(blob.subarray(12, 28));
  return Buffer.concat([d.update(blob.subarray(28)), d.final()]).toString("utf8");
}

export const sha256Hex = (v: string): string => createHash("sha256").update(v).digest("hex");
export const newOpaqueToken = (): string => randomBytes(32).toString("base64url");

/** 10 recovery codes, each 10 chars from an unambiguous alphabet, grouped 5-5. Shown once, stored hashed. */
export function newRecoveryCodes(n = 10): string[] {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: n }, () => {
    const b = randomBytes(10);
    const chars = Array.from(b, (x) => alphabet[x % alphabet.length]).join("");
    return `${chars.slice(0, 5)}-${chars.slice(5)}`;
  });
}
export const normalizeRecoveryCode = (c: string): string => c.trim().toUpperCase().replace(/\s+/g, "");
