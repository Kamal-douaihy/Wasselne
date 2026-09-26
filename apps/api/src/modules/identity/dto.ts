import { z } from "zod";

// Mirrors the request bodies in docs/phase-2/openapi.yaml (OtpRequestBody, OtpVerifyBody,
// CompleteProfileBody). Unknown keys are stripped, not rejected.
export const phoneE164 = z.string().regex(/^\+[1-9][0-9]{6,14}$/, "must be an E.164 phone number");
export const appKind = z.enum(["RIDER", "DRIVER"]);

export const requestOtpSchema = z.object({ phone_e164: phoneE164, app: appKind });
export type RequestOtpDto = z.infer<typeof requestOtpSchema>;

export const verifyOtpSchema = z.object({
  challenge_id: z.string().uuid(),
  code: z.string().min(4).max(8),
});
export type VerifyOtpDto = z.infer<typeof verifyOtpSchema>;

export const completeProfileSchema = z.object({
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  gender: z.enum(["FEMALE", "MALE"]),
  email: z.string().email().optional(),
  language: z.enum(["ar", "en", "fr"]).optional(),
  accepted_legal_version_ids: z.array(z.string().uuid()),
});
export type CompleteProfileDto = z.infer<typeof completeProfileSchema>;

export const refreshSchema = z.object({ refresh_token: z.string().min(1) });
export type RefreshDto = z.infer<typeof refreshSchema>;

export const profileUpdateSchema = z.object({
  first_name: z.string().trim().min(1).max(100).optional(),
  last_name: z.string().trim().min(1).max(100).optional(),
  email: z.string().email().optional(),
  language: z.enum(["ar", "en", "fr"]).optional(),
  preferred_currency: z.string().regex(/^[A-Z]{3}$/).optional(),
});
export type ProfileUpdateDto = z.infer<typeof profileUpdateSchema>;

export const pushDeviceSchema = z.object({
  platform: z.enum(["android", "ios"]),
  token: z.string().min(1).max(4096),
});
export type PushDeviceDto = z.infer<typeof pushDeviceSchema>;
