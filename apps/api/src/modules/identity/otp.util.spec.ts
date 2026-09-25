import { generateOtpCode, hashOtpCode, verifyOtpCode, generateRefreshToken, hashToken } from "./otp.util";

describe("otp.util", () => {
  it("generates a 6-digit code", () => {
    for (let i = 0; i < 50; i++) {
      expect(generateOtpCode()).toMatch(/^\d{6}$/);
    }
  });

  it("verifies a code against its own hash", () => {
    const code = "042817";
    const hash = hashOtpCode(code);
    expect(verifyOtpCode(code, hash)).toBe(true);
  });

  it("rejects a wrong code", () => {
    const hash = hashOtpCode("042817");
    expect(verifyOtpCode("000000", hash)).toBe(false);
  });

  it("produces a different hash for the same code each time (random salt)", () => {
    expect(hashOtpCode("042817")).not.toEqual(hashOtpCode("042817"));
  });

  it("hashes refresh tokens deterministically for lookup", () => {
    const token = generateRefreshToken();
    expect(hashToken(token)).toEqual(hashToken(token));
    expect(hashToken(token)).not.toEqual(token);
  });
});
