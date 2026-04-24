/**
 * NotificationService — sends admin notifications for key task lifecycle events.
 *
 * Uses plain Markdown (not MarkdownV2) throughout to avoid escaping issues.
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
  notifyTaskStarted(employee: User, task: Task, project: Project, startedAt: Date): Promise<void>;
  notifyTaskCompleted(employee: User, task: Task, project: Project, totalTime: TimeSpent, attachments: Attachment[]): Promise<void>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getDisplayName(user: User): string {
  if (user.first_name) return user.first_name;
  if (user.username) return `@${user.username}`;
  return user.telegram_id?.toString() ?? 'Unknown';
}

/** Escape characters that break plain Markdown in Telegram: _ * ` [ ] */
function esc(s: string): string {
  return s.replace(/[_*`[\]]/g, (c) => '\\' + c);
}

/**
 * Formats a single attachment line for a plain Markdown message.
 * File content is stored as "filename\nurl".
 */
function formatAttachment(a: Attachment, index: number): string {
  if (a.type === 'text') {
    const display = a.content.replace(/^💬\s*/, '');
    return `  ${index + 1}. 📝 ${display}`;
  }

  const newlineIdx = a.content.indexOf('\n');
  if (newlineIdx === -1) {
    // Legacy bare URL
    return `  ${index + 1}. [📎 Файл](${a.content})`;
  }

  const fileName = a.content.slice(0, newlineIdx).trim();
  const url = a.content.slice(newlineIdx + 1).trim();
  const isImage = /\.(jpe?g|png|gif|webp|heic|bmp)$/i.test(fileName);
  const icon = isImage ? '🖼' : '📎';

  return `  ${index + 1}. [${icon} ${fileName}](${url})`;
}

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

async function sendToAdmin(admin: User, text: string): Promise<void> {
  if (!admin.telegram_id) return;
  try {
    await telegramClient.sendNotification(admin.telegram_id, text, {
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
    });
  } catch (err) {
    if (err instanceof TelegramApiError) {
      logger.error(
        `NotificationService: failed to notify admin ${admin.telegram_id} (${getDisplayName(admin)})`,
        err,
      );
      // Do NOT rethrow — continue to next admin (Req 11.4)
    } else {
      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export const notificationService: NotificationService = {
  async notifyTaskStarted(employee, task, project, startedAt) {
    const admins = await fetchAdmins();
    if (admins.length === 0) return;

    const text =
      `🔔 *Нова задача розпочата*\n\n` +
      `👤 *Співробітник:* ${esc(getDisplayName(employee))}\n` +
      `📌 *Задача:* ${esc(task.name)}\n` +
      `📁 *Проєкт:* ${esc(project.name)}\n` +
      `🕐 *Початок:* ${formatDateTime(startedAt)}`;

    await Promise.all(admins.map((admin) => sendToAdmin(admin, text)));
  },

  async notifyTaskCompleted(employee, task, project, totalTime, attachments) {
    const admins = await fetchAdmins();
    if (admins.length === 0) return;

    let text =
      `✅ *Задачу завершено*\n\n` +
      `👤 *Співробітник:* ${esc(getDisplayName(employee))}\n` +
      `📌 *Задача:* ${esc(task.name)}\n` +
      `📁 *Проєкт:* ${esc(project.name)}\n` +
      `⏱ *Витрачено:* ${esc(formatTimeSpent(totalTime))}`;

    if (attachments.length > 0) {
      const lines = attachments.map((a, i) => formatAttachment(a, i)).join('\n');
      text += `\n\n📋 *Результати (${attachments.length}):*\n${lines}`;
    }

    await Promise.all(admins.map((admin) => sendToAdmin(admin, text)));
  },
};
