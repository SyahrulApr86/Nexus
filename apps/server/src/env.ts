import { z } from "zod";

// Load apps/server/.env in dev; existing process.env values always win,
// so tests and production env vars are unaffected.
try {
  process.loadEnvFile(new URL("../.env", import.meta.url).pathname);
} catch {
  /* no .env file — rely on real environment */
}

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  CONTENT_ENCRYPTION_KEY: z.string().min(8),
  SMTP_HOST: z.string().default("localhost"),
  SMTP_PORT: z.coerce.number().default(1025),
  MAIL_FROM: z.string().default("Nexus <no-reply@nexus.local>"),
  APP_ORIGIN: z.string().url().default("http://localhost:5173"),
  PORT: z.coerce.number().default(3001),
  COOKIE_SECURE: z
    .string()
    .default("true")
    .transform((v) => v !== "false"),
});

export type Env = z.infer<typeof envSchema>;

export const env: Env = envSchema.parse(process.env);
