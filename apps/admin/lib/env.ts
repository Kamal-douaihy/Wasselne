import { z } from "zod";

const envSchema = z.object({
  API_BASE_URL: z.string().url().default("http://localhost:3000"),
});

// A plain string-keyed record rather than NodeJS.ProcessEnv: Next.js augments ProcessEnv to
// require NODE_ENV, which would force every call site (including tests) to fake that field.
export function loadAdminEnv(source: Record<string, string | undefined> = process.env) {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid admin environment configuration:\n${issues}`);
  }
  return parsed.data;
}
