/**
 * Shared TypeScript types for the Telegram Time Tracker application.
 * These types are used across the entire application for type safety.
 */

// ---------------------------------------------------------------------------
// Primitive / Enum Types
// ---------------------------------------------------------------------------

export type UserRole = 'admin' | 'employee';
export type TaskStatus = 'in_progress' | 'paused' | 'completed';
export type AttachmentType = 'file' | 'text';
export type SessionState =
  | 'idle'
  | 'awaiting_project_name'
  | 'awaiting_task_name'
  | 'awaiting_deliverable'
  | 'awaiting_deliverable_choice'
  | 'awaiting_new_admin_id'
  | 'awaiting_new_employee_id'
  | 'awaiting_new_user_name'
  | 'awaiting_invite_project_select'
  | 'awaiting_invite_role_select';

// ---------------------------------------------------------------------------
// Domain / Database Interfaces
// ---------------------------------------------------------------------------

export interface User {
  id: string;
  telegram_id: number;
  role: UserRole;
  first_name: string | null;
  username: string | null;
  created_at: string;
}

export interface Project {
  id: string;
  name: string;
  is_active: boolean;
  created_at: string;
}

export interface Task {
  id: string;
  project_id: string;
  user_id: string;
  name: string;
  status: TaskStatus;
  created_at: string;
}

export interface TimeLog {
  id: string;
  task_id: string;
  started_at: string;
  paused_at: string | null;
  ended_at: string | null;
}

export interface Attachment {
  id: string;
  task_id: string;
  type: AttachmentType;
  /** URL for file attachments; plain text for text attachments */
  content: string;
  created_at: string;
}

export interface Session {
  id: string;
  user_id: string;
  state: SessionState | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  context: Record<string, any> | null;
  updated_at: string;
}

export interface InviteToken {
  token: string;
  project_id: string;
  role: UserRole;
  created_by: string;
  used_by: string | null;
  expires_at: string;
  used_at: string | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Telegram API Types
// ---------------------------------------------------------------------------

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface TelegramMessage {
  message_id: number;
  from: TelegramUser;
  chat: TelegramChat;
  text?: string;
  document?: TelegramDocument;
  photo?: TelegramPhotoSize[];
  sticker?: { file_id: string };
  forward_from?: TelegramUser;
  forward_sender_name?: string;
  /** New Bot API forward origin object */
  forward_origin?: {
    type: string;
    sender_user?: TelegramUser;
    sender_user_name?: string;
    date: number;
  };
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
}

export interface TelegramUser {
  id: number;
  first_name: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
  type: string;
}

export interface TelegramDocument {
  file_id: string;
  file_name?: string;
  file_size?: number;
}

export interface TelegramPhotoSize {
  file_id: string;
  width: number;
  height: number;
  file_size?: number;
}

// ---------------------------------------------------------------------------
// Service / Handler Types
// ---------------------------------------------------------------------------

export interface HandlerContext {
  user: User;
  session: Session;
  telegramId: number;
  chatId: number;
  /** Message ID of the triggering message — set for callback queries, undefined for text messages. */
  messageId?: number;
}

/** Result of a time calculation across one or more TimeLog intervals. */
export interface TimeSpent {
  hours: number;
  minutes: number;
  totalMinutes: number;
}

/** A single task entry used in activity reports. */
export interface TaskActivity {
  taskName: string;
  projectName: string;
  status: TaskStatus;
  timeSpent: TimeSpent;
  startedAt: string;
}

/** Aggregated project summary used in weekly activity reports. */
export interface ProjectSummary {
  projectName: string;
  timeSpent: TimeSpent;
  taskCount: number;
}

// ---------------------------------------------------------------------------
// Session Context Interfaces
// ---------------------------------------------------------------------------

/** Stored in Session.context when state = 'awaiting_task_name'. */
export interface AwaitingTaskNameContext {
  selectedProjectId: string;
  selectedProjectName: string;
}

/** Stored in Session.context when state = 'awaiting_deliverable' or 'awaiting_deliverable_choice'. */
export interface AwaitingDeliverableContext {
  taskId: string;
  taskName: string;
  attachmentCount: number;
}

// ---------------------------------------------------------------------------
// Domain Error Classes
// ---------------------------------------------------------------------------

/** Thrown when an employee tries to start a task while one is already in_progress. */
export class ActiveTaskExistsError extends Error {
  constructor(message = 'An active task already exists') {
    super(message);
    this.name = 'ActiveTaskExistsError';
  }
}

/** Thrown when an operation requires an in_progress task but none is found. */
export class NoActiveTaskError extends Error {
  constructor(message = 'No active task found') {
    super(message);
    this.name = 'NoActiveTaskError';
  }
}

/** Thrown when a resume operation is attempted but no paused task exists. */
export class NoPausedTaskError extends Error {
  constructor(message = 'No paused task found') {
    super(message);
    this.name = 'NoPausedTaskError';
  }
}

/** Thrown when a project with the same name already exists. */
export class DuplicateProjectError extends Error {
  constructor(message = 'A project with this name already exists') {
    super(message);
    this.name = 'DuplicateProjectError';
  }
}

/** Thrown when an uploaded file exceeds the 20 MB size limit. */
export class FileTooLargeError extends Error {
  constructor(message = 'File exceeds the 20 MB size limit') {
    super(message);
    this.name = 'FileTooLargeError';
  }
}

/** Thrown when a user attempts an action they are not authorized to perform. */
export class UnauthorizedError extends Error {
  constructor(message = 'Unauthorized') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

/** Thrown when user-supplied input fails validation rules. */
export class ValidationError extends Error {
  constructor(message = 'Validation failed') {
    super(message);
    this.name = 'ValidationError';
  }
}

/** Thrown when a Supabase / PostgreSQL database operation fails. */
export class DatabaseError extends Error {
  constructor(message = 'Database error') {
    super(message);
    this.name = 'DatabaseError';
  }
}

/** Thrown when a Telegram Bot API call fails. */
export class TelegramApiError extends Error {
  constructor(message = 'Telegram API error') {
    super(message);
    this.name = 'TelegramApiError';
  }
}

/** Thrown when a Supabase Storage operation fails. */
export class StorageError extends Error {
  constructor(message = 'Storage error') {
    super(message);
    this.name = 'StorageError';
  }
}
