import { z } from "zod";

const envSchema = z.object({
  NEXTAUTH_SECRET: z.string().min(1),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().min(1),
  GMAIL_SENDER_EMAIL: z.string().trim().email().optional(),
  GMAIL_OAUTH_CLIENT_ID: z.string().trim().min(1).optional(),
  GMAIL_OAUTH_CLIENT_SECRET: z.string().trim().min(1).optional(),
  GMAIL_REFRESH_TOKEN: z.string().trim().min(1).optional(),
  PHOTOS_FOLDER_ID: z.string().min(1),
  VIEWER_PIN: z.string().min(1),
  ENABLE_MULTI_TENANT_SESSION: z.string().trim().optional(),
});

export type AppEnv = z.infer<typeof envSchema>;

let cache: AppEnv | null = null;

export function getEnv(): AppEnv {
  if (cache) {
    return cache;
  }

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Missing or invalid environment variables: ${parsed.error.message}`);
  }

  cache = parsed.data;
  return cache;
}
