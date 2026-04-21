/**
 * SessionService — manages per-user conversation state stored in the `sessions` table.
 *
 * Responsibilities:
 *  - getSession: upsert a session row and return it
 *  - setState: update state, context, and updated_at
 *  - resetSession: clear state and context
 *  - isExpired: check whether a session is older than 24 hours
 */

import { supabase } from '@/lib/db/client';
import { logger } from '@/lib/utils/logger';
import { DatabaseError, Session, SessionState } from '@/types/index';

/** 24 hours in milliseconds */
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export interface SessionService {
  getSession(userId: string): Promise<Session>;
  setState(userId: string, state: SessionState | null, context?: Record<string, unknown>): Promise<void>;
  resetSession(userId: string): Promise<void>;
  isExpired(session: Session): boolean;
}

/**
 * Maps a raw Supabase row to the domain `Session` type.
 * The `context` column is JSONB so Supabase returns it as `Record<string, unknown> | null`.
 */
function mapRow(row: {
  id: string;
  user_id: string;
  state: string | null;
  context: Record<string, unknown> | null;
  updated_at: string;
}): Session {
  return {
    id: row.id,
    user_id: row.user_id,
    state: (row.state as SessionState | null) ?? null,
    context: row.context ?? null,
    updated_at: row.updated_at,
  };
}

export const sessionService: SessionService = {
  /**
   * Returns the session for `userId`, creating one if it does not yet exist.
   * Uses an upsert on the unique `user_id` column so the operation is idempotent.
   */
  async getSession(userId: string): Promise<Session> {
    const { data, error } = await supabase
      .from('sessions')
      .upsert(
        { user_id: userId, updated_at: new Date().toISOString() },
        { onConflict: 'user_id', ignoreDuplicates: true }
      )
      .select('id, user_id, state, context, updated_at')
      .single();

    if (error || !data) {
      // If upsert returned nothing (row already existed and ignoreDuplicates suppressed the return),
      // fall back to a plain select.
      const { data: existing, error: selectError } = await supabase
        .from('sessions')
        .select('id, user_id, state, context, updated_at')
        .eq('user_id', userId)
        .single();

      if (selectError || !existing) {
        logger.error('SessionService.getSession failed', selectError ?? error);
        throw new DatabaseError('Failed to get or create session');
      }

      return mapRow(existing);
    }

    return mapRow(data);
  },

  /**
   * Updates the session's `state`, `context`, and `updated_at` for `userId`.
   * Passing `undefined` for `context` leaves the context column unchanged.
   */
  async setState(
    userId: string,
    state: SessionState | null,
    context?: Record<string, unknown>
  ): Promise<void> {
    const updates: Record<string, unknown> = {
      state,
      updated_at: new Date().toISOString(),
    };

    if (context !== undefined) {
      updates.context = context;
    }

    const { error } = await supabase
      .from('sessions')
      .update(updates)
      .eq('user_id', userId);

    if (error) {
      logger.error('SessionService.setState failed', error);
      throw new DatabaseError('Failed to update session state');
    }
  },

  /**
   * Resets the session to a clean slate: `state = null`, `context = null`.
   */
  async resetSession(userId: string): Promise<void> {
    const { error } = await supabase
      .from('sessions')
      .update({
        state: null,
        context: null,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId);

    if (error) {
      logger.error('SessionService.resetSession failed', error);
      throw new DatabaseError('Failed to reset session');
    }
  },

  /**
   * Returns `true` when the session's `updated_at` timestamp is older than 24 hours.
   */
  isExpired(session: Session): boolean {
    const updatedAt = new Date(session.updated_at).getTime();
    return Date.now() - updatedAt > SESSION_TTL_MS;
  },
};
