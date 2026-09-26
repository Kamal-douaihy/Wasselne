import { z } from "zod";

export const onboardingProfileSchema = z.object({
  first_name: z.string().trim().min(1).max(100),
  last_name: z.string().trim().min(1).max(100),
  gender: z.enum(["FEMALE", "MALE"]),
  email: z.string().email().optional(),
  accepted_legal_version_ids: z.array(z.string().uuid()),
});
export type OnboardingProfileDto = z.infer<typeof onboardingProfileSchema>;

export const vehicleSchema = z.object({
  base_type: z.enum(["CAR", "MOTORCYCLE", "TUKTUK"]),
  make: z.string().trim().min(1).max(60),
  model: z.string().trim().min(1).max(60),
  year: z.number().int().min(1980).max(new Date().getFullYear() + 1).nullable().optional(),
  color: z.string().trim().min(1).max(40),
  plate: z.string().trim().min(1).max(20),
  seats: z.number().int().min(1).max(60),
});
export type VehicleDto = z.infer<typeof vehicleSchema>;

export const categoriesSchema = z.object({ category_ids: z.array(z.string().uuid()).min(1).max(20) });
export type CategoriesDto = z.infer<typeof categoriesSchema>;

export const documentAttachSchema = z.object({
  document_type_id: z.string().uuid(),
  vehicle_id: z.string().uuid().nullable().optional(),
  upload_id: z.string().uuid(),
  expires_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});
export type DocumentAttachDto = z.infer<typeof documentAttachSchema>;
