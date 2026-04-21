/**
 * Environment variable validation module.
 *
 * Exports typed getters for all required environment variables.
 * Validation is deferred to runtime (first access) so that missing variables
 * cause a clear runtime error rather than a build-time failure on Vercel.
 *
 * Requirements: 15.1
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}\n` +
        `Please set ${name} in your .env.local file (for local development) ` +
        `or in your Vercel project environment variables (for production).\n` +
        `See README.md for the full list of required environment variables.`
    );
  }
  return value;
}

/** Telegram Bot token obtained from @BotFather. */
export const getTelegramBotToken = (): string => requireEnv('TELEGRAM_BOT_TOKEN');

/** Secret token for webhook authentication. */
export const getTelegramWebhookSecret = (): string => requireEnv('TELEGRAM_WEBHOOK_SECRET');

/** Supabase project URL. */
export const getSupabaseUrl = (): string => requireEnv('NEXT_PUBLIC_SUPABASE_URL');

/** Supabase service role key (server-side only). */
export const getSupabaseServiceRoleKey = (): string => requireEnv('SUPABASE_SERVICE_ROLE_KEY');

/** Supabase Storage bucket name. */
export const getSupabaseStorageBucket = (): string => requireEnv('SUPABASE_STORAGE_BUCKET');

/** Public URL of the deployed application. */
export const getAppUrl = (): string => requireEnv('NEXT_PUBLIC_APP_URL');

// Convenience re-exports for code that expects plain string constants.
// These are evaluated lazily via getters so they don't throw at import time.
export const TELEGRAM_BOT_TOKEN = getTelegramBotToken;
export const TELEGRAM_WEBHOOK_SECRET = getTelegramWebhookSecret;
export const SUPABASE_URL = getSupabaseUrl;
export const SUPABASE_SERVICE_ROLE_KEY = getSupabaseServiceRoleKey;
export const SUPABASE_STORAGE_BUCKET = getSupabaseStorageBucket;
export const APP_URL = getAppUrl;
