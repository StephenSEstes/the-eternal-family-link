import { z } from "zod";

const envSchema = z.object({
  NEXTAUTH_SECRET: z.string().min(1),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  GOOGLE_SERVICE_ACCOUNT_JSON: z.string().min(1),
  SHEET_ID: z.string().min(1),
  PHOTOS_FOLDER_ID: z.string().min(1),
  VIEWER_PIN: z.string().min(1),
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