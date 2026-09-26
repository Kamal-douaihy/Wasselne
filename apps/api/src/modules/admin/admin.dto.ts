import { z } from "zod";
import { pageQuerySchema } from "../../common/cursor";

export const loginSchema = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(500) });
export const codeSchema = z.object({ code: z.string().regex(/^\d{6}$/) });
export const recoverySchema = z.object({ recovery_code: z.string().min(4).max(64) });

const reason = z.string().trim().min(3).max(1000);
export const reasonSchema = z.object({ reason });
export const blockSchema = z.object({ applies_to: z.array(z.enum(["RIDER", "DRIVER"])).min(1), reason });
export const genderConfirmSchema = z.object({ confirmed_gender: z.enum(["FEMALE", "MALE"]), reason });
export const categoryEditSchema = z.object({
  category_id: z.string().uuid(),
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "PAUSED_BY_DRIVER"]),
  reason: z.string().trim().min(3).max(500),
});
export const documentDecisionSchema = z.object({ reason: z.string().trim().min(3).max(500) });
export const queueQuerySchema = pageQuerySchema.extend({
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "NEEDS_CHANGES"]).optional(),
  category_id: z.string().uuid().optional(),
  zone_id: z.string().uuid().optional(),
});
export const auditQuerySchema = pageQuerySchema.extend({
  admin_id: z.string().uuid().optional(),
  target_type: z.string().max(60).optional(),
  target_id: z.string().max(100).optional(),
  action: z.string().max(100).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});
export { pageQuerySchema };
