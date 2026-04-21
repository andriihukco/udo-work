/**
 * Supabase client singleton for server-side use only.
 *
 * Uses the SERVICE ROLE KEY (not the anon key) to bypass Row Level Security
 * and perform privileged database operations. This module must never be
 * imported in client-side (browser) code.
 *
 * The client is initialised lazily on first access so that missing env vars
 * cause a runtime error (not a build-time error on Vercel).
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

let _supabase: SupabaseClient | null = null;

function getSupabaseClient(): SupabaseClient {
  if (_supabase) return _supabase;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) {
    throw new Error(
      'Missing environment variable: NEXT_PUBLIC_SUPABASE_URL must be set.'
    );
  }

  if (!supabaseServiceRoleKey) {
    throw new Error(
      'Missing environment variable: SUPABASE_SERVICE_ROLE_KEY must be set.'
    );
  }

  _supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      // Disable automatic session persistence — this is a server-side client
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return _supabase;
}

/**
 * Proxy that initialises the Supabase client on first property access.
 * Use this everywhere instead of calling getSupabaseClient() directly.
 */
export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    return (getSupabaseClient() as unknown as Record<string | symbol, unknown>)[prop];
  },
});
