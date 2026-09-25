import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().positive().default(3000),
  // Number of reverse-proxy hops to trust for X-Forwarded-For. 0 = use the socket address.
  // Per-IP abuse controls are only as good as this value: set it to the real hop count in prod.
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(0),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  REDIS_URL: z.string().min(1, "REDIS_URL is required"),
  REDIS_KEY_PREFIX: z.string().default("wsl:"),

  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be at least 32 characters"),
  JWT_ACCESS_TTL_S: z.coerce.number().int().positive().default(15 * 60),
  JWT_REFRESH_TTL_S: z.coerce.number().int().positive().default(30 * 24 * 60 * 60),
  NEEDS_PROFILE_TTL_S: z.coerce.number().int().positive().default(10 * 60),

  OTP_TTL_S: z.coerce.number().int().positive().default(5 * 60),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  OTP_RESEND_INTERVAL_S: z.coerce.number().int().min(0).default(30),
  OTP_REQUEST_LIMIT_PER_PHONE_PER_HOUR: z.coerce.number().int().positive().default(5),
  OTP_REQUEST_LIMIT_PER_IP_PER_HOUR: z.coerce.number().int().positive().default(20),
  OTP_VERIFY_LIMIT_PER_IP_PER_HOUR: z.coerce.number().int().positive().default(30),
  GLOBAL_LIMIT_PER_IP_PER_MINUTE: z.coerce.number().int().positive().default(300),

  // dev: the code is stored in Redis for local tools/tests to read (never returned by the API).
  // disabled: no SMS provider is configured; OTP requests answer 503 PROVIDER_TEMPORARY_FAILURE.
  SMS_ADAPTER: z.enum(["dev", "disabled"]).default("dev"),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === "production" && env.SMS_ADAPTER === "dev") {
    throw new Error("SMS_ADAPTER=dev is refused in production (dev OTP codes must never ship live).");
  }
  return env;
}
