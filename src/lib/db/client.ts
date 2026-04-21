/**
 * Supabase client singleton for server-side use only.
 *
 * Uses the SERVICE ROLE KEY (not the anon key) to bypass Row Level Security
 * and perform privileged database operations. This module must never be
 * imported in client-side (browser) code.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) {
  throw new Error(
    'Missing environment variable: NEXT_PUBLIC_SUPABASE_URL must be set before importing the Supabase client.'
  );
}

if (!supabaseServiceRoleKey) {
  throw new Error(
    'Missing environment variable: SUPABASE_SERVICE_ROLE_KEY must be set before importing the Supabase client.'
  );
}

export const supabase: SupabaseClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    // Disable automatic session persistence — this is a server-side client
    persistSession: false,
    autoRefreshToken: false,
  },
});
