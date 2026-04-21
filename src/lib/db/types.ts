/**
 * Database row types matching the schema columns exactly.
 * These types represent the raw rows returned by the Supabase JS client.
 *
 * Type mapping:
 *   UUID        → string
 *   TIMESTAMPTZ → string
 *   BIGINT      → number
 *   BOOLEAN     → boolean
 *   TEXT        → string (or literal union for enum-like columns)
 *   JSONB       → Record<string, unknown> | null
 */

export interface UserRow {
  id: string;
  telegram_id: number;
  role: 'admin' | 'employee';
  first_name: string | null;
  username: string | null;
  created_at: string;
}

export interface ProjectRow {
  id: string;
  name: string;
  is_active: boolean;
  created_at: string;
}

export interface ProjectMemberRow {
  project_id: string;
  user_id: string;
  added_at: string;
}

export interface InviteTokenRow {
  token: string;
  project_id: string;
  role: 'admin' | 'employee';
  created_by: string;
  used_by: string | null;
  expires_at: string;
  used_at: string | null;
  created_at: string;
}

export interface TaskRow {
  id: string;
  project_id: string;
  user_id: string;
  name: string;
  status: 'in_progress' | 'paused' | 'completed';
  created_at: string;
}

export interface TimeLogRow {
  id: string;
  task_id: string;
  started_at: string;
  paused_at: string | null;
  ended_at: string | null;
}

export interface AttachmentRow {
  id: string;
  task_id: string;
  type: 'file' | 'text';
  content: string;
  created_at: string;
}

export interface SessionRow {
  id: string;
  user_id: string;
  state: string | null;
  context: Record<string, unknown> | null;
  updated_at: string;
}
