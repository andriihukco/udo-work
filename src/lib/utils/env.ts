/**
 * Environment variable validation module.
 *
 * Reads and validates all required environment variables at module load time.
 * Throws a descriptive error immediately if any required variable is missing,
 * so misconfiguration is caught at startup rather than at runtime.
 *
 * Requirements: 15.1
 */

// ---------------------------------------------------------------------------
// Validation helper
// ---------------------------------------------------------------------------

/**
 * Reads a required environment variable.
 * Throws a descriptive error if the variable is not set or is empty.
 */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable: ${name}\n` +
        `Please set ${name} in your .env.local file (for local development) ` +
        `or in your Vercel project environment variables (for production).\n` +
        `See README.md for the full list of required environment variables.`,
    );
  }
  return value;
}

// ---------------------------------------------------------------------------
// Validated environment variable exports
// ---------------------------------------------------------------------------

/**
 * Telegram Bot token obtained from @BotFather.
 * Used to authenticate all Telegram Bot API requests.
 */
export const TELEGRAM_BOT_TOKEN: string = requireEnv('TELEGRAM_BOT_TOKEN');

/**
 * Secret token used to authenticate incoming webhook requests from Telegram.
 * Must match the value registered via the Telegram setWebhook API call.
 */
export const TELEGRAM_WEBHOOK_SECRET: string = requireEnv('TELEGRAM_WEBHOOK_SECRET');

/**
 * Supabase project URL (public, safe to expose to the browser).
 * Example: https://xyzcompany.supabase.co
 */
export const SUPABASE_URL: string = requireEnv('NEXT_PUBLIC_SUPABASE_URL');

/**
 * Supabase service role key (secret — server-side only).
 * Bypasses Row Level Security; must never be exposed to the browser.
 */
export const SUPABASE_SERVICE_ROLE_KEY: string = requireEnv('SUPABASE_SERVICE_ROLE_KEY');

/**
 * Supabase Storage bucket name for task attachments.
 * Example: task-attachments
 */
export const SUPABASE_STORAGE_BUCKET: string = requireEnv('SUPABASE_STORAGE_BUCKET');

/**
 * Public URL of the deployed application.
 * Used when registering the Telegram webhook via setWebhook.
 * Example: https://your-app.vercel.app
 */
export const APP_URL: string = requireEnv('NEXT_PUBLIC_APP_URL');
