/**
 * NotificationService — sends admin notifications for key task lifecycle events.
 *
 * Implements fan-out to all admin users via Telegram messages.
 * Per Requirement 11.4: if sending to one admin fails with TelegramApiError,
 * the error is logged and execution continues to the next admin (no rethrow).
 *
 * Requirements: 11.1, 11.2, 11.3, 11.4
 */

import { supabase } from '@/lib/db/client';
import { logger } from '@/lib/utils/logger';
import { formatDateTime, formatTimeSpent } from '@/lib/utils/time';
import * as telegramClient from '@/lib/telegram/client';
import { DatabaseError, TelegramApiError } from '@/types/index';
import type { User, Task, Project, TimeSpent, Attachment } from '@/types/index';
import type { UserRow } from '@/lib/db/types';

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface NotificationService {
  /**
   * Notifies all admin users that an employee has started a task.
   * Req 11.1, 11.3
   */
  notifyTaskStarted(
    employee: User,
    task: Task,
    project: Project,
    startedAt: Date,
  ): Promise<void>;

  /**
   * Notifies all admin users that an employee has completed a task.
   * Req 11.2, 11.3
   */
  notifyTaskCompleted(
    employee: User,
    task: Task,
    project: Project,
    totalTime: TimeSpent,
    attachments: Attachment[],
  ): Promise<void>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns the best available display name for a user.
 * Mirrors the logic in UserService.getDisplayName to avoid a circular dep.
 */
function getDisplayName(user: User): string {
  if (user.first_name) return user.first_name;
  if (user.username) return `@${user.username}`;
  return user.telegram_id?.toString() ?? 'Unknown';
}

/**
 * Formats a single attachment for a Telegram Markdown message.
 *
 * - text attachments: rendered inline as plain text (comments, notes)
 * - file attachments: stored as "filename\nurl"; rendered as a Telegram
 *   inline hyperlink [label](url) so the URL is hidden and the message
 *   stays readable. Images get a 🖼 prefix, other files get 📎.
 *
 * Falls back gracefully for legacy rows that stored only a bare URL.
 */
function formatAttachment(a: Attachment, index: number): string {
  if (a.type === 'text') {
    return `  ${index + 1}\\. 📝 ${a.content}`;
  }

  // File attachment: content is "filename\nurl" (new format)
  // or a bare URL (legacy rows before this change)
  const newlineIdx = a.content.indexOf('\n');
  if (newlineIdx === -1) {
    // Legacy: bare URL — show as hyperlink with generic label
    return `  ${index + 1}\\. [📎 Файл](${a.content})`;
  }

  const fileName = a.content.slice(0, newlineIdx).trim();
  const url = a.content.slice(newlineIdx + 1).trim();

  const isImage = /\.(jpe?g|png|gif|webp|heic|bmp)$/i.test(fileName);
  const icon = isImage ? '🖼' : '📎';
  // Escape any parentheses in the filename for Markdown link syntax
  const safeLabel = fileName.replace(/[()]/g, '\\$&');

  return `  ${index + 1}\\. [${icon} ${safeLabel}](${url})`;
}

/**
 * Fetches all users with role = 'admin' from the database.
 * Throws DatabaseError on query failure.
 */
async function fetchAdmins(): Promise<User[]> {
  const { data, error } = await supabase
    .from('users')
    .select('id, telegram_id, role, first_name, username, created_at')
    .eq('role', 'admin');

  if (error) {
    logger.error('NotificationService.fetchAdmins failed', error);
    throw new DatabaseError('Failed to fetch admin users for notification');
  }

  return (data ?? []) as UserRow[];
}

/**
 * Sends a message to a single admin, catching and logging TelegramApiError
 * without rethrowing (Req 11.4).
 */
async function sendToAdmin(
  admin: User,
  text: string,
  options: Record<string, unknown> = { parse_mode: 'Markdown' },
): Promise<void> {
  if (!admin.telegram_id) return; // placeholder user — no ID yet, skip
  try {
    await telegramClient.sendNotification(admin.telegram_id, text, options);
  } catch (err) {
    if (err instanceof TelegramApiError) {
      logger.error(
        `NotificationService: failed to notify admin ${admin.telegram_id} (${getDisplayName(admin)})`,
        err,
      );
      // Do NOT rethrow — continue to next admin (Req 11.4)
    } else {
      // Unexpected errors are re-thrown so they surface properly
      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export const notificationService: NotificationService = {
  /**
   * Fetches all admins and sends each a task-started notification.
   * Req 11.1, 11.3
   */
  async notifyTaskStarted(
    employee: User,
    task: Task,
    project: Project,
    startedAt: Date,
  ): Promise<void> {
    const admins = await fetchAdmins();

    if (admins.length === 0) {
      logger.info('NotificationService.notifyTaskStarted: no admin users found, skipping');
      return;
    }

    const employeeName = getDisplayName(employee);
    const text =
      `🔔 *Нова задача розпочата*\n\n` +
      `👤 *Співробітник:* ${employeeName}\n` +
      `📌 *Задача:* ${task.name}\n` +
      `📁 *Проєкт:* ${project.name}\n` +
      `🕐 *Початок:* ${formatDateTime(startedAt)}`;

    await Promise.all(admins.map((admin) => sendToAdmin(admin, text)));
  },

  /**
   * Fetches all admins and sends each a task-completed notification.
   * Includes attachment list when non-empty.
   * File attachments are rendered as inline hyperlinks to keep messages short.
   * Req 11.2, 11.3
   */
  async notifyTaskCompleted(
    employee: User,
    task: Task,
    project: Project,
    totalTime: TimeSpent,
    attachments: Attachment[],
  ): Promise<void> {
    const admins = await fetchAdmins();

    if (admins.length === 0) {
      logger.info('NotificationService.notifyTaskCompleted: no admin users found, skipping');
      return;
    }

    const employeeName = getDisplayName(employee);

    // Escape special MarkdownV2 chars in plain-text fields
    const esc2 = (s: string) => s.replace(/[_*[\]()~`>#+=|{}.!\\-]/g, '\\$&');

    let text =
      `✅ *Задачу завершено*\n\n` +
      `👤 *Співробітник:* ${esc2(employeeName)}\n` +
      `📌 *Задача:* ${esc2(task.name)}\n` +
      `📁 *Проєкт:* ${esc2(project.name)}\n` +
      `⏱ *Витрачено часу:* ${esc2(formatTimeSpent(totalTime))}`;

    if (attachments.length > 0) {
      const lines = attachments.map((a, i) => formatAttachment(a, i)).join('\n');
      text += `\n\n📋 *Результати \\(${attachments.length}\\):*\n${lines}`;
    }

    await Promise.all(
      admins.map((admin) =>
        sendToAdmin(admin, text, { parse_mode: 'MarkdownV2' }),
      ),
    );
  },
};
