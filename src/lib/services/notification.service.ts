/**
 * NotificationService — sends admin notifications for task lifecycle events.
 * Uses plain Markdown throughout. Requirements: 11.1–11.4
 */

import { supabase } from '@/lib/db/client';
import { logger } from '@/lib/utils/logger';
import { formatDateTime, formatTimeSpent } from '@/lib/utils/time';
import * as telegramClient from '@/lib/telegram/client';
import { DatabaseError, TelegramApiError } from '@/types/index';
import type { User, Task, Project, TimeSpent, Attachment } from '@/types/index';
import type { UserRow } from '@/lib/db/types';

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

/** Escape plain Markdown special chars: _ * ` [ ] */
function esc(s: string): string {
  return s.replace(/[_*`[\]]/g, (c) => '\\' + c);
}

/**
 * Format one attachment line.
 * File content stored as "filename\nurl"; text stored as plain string.
 */
function formatAttachment(a: Attachment, index: number): string {
  if (a.type === 'text') {
    const display = esc(a.content.replace(/^💬\s*/, '').trim());
    return `  ${index + 1}. 💬 ${display}`;
  }

  const nl = a.content.indexOf('\n');
  if (nl === -1) {
    return `  ${index + 1}. [📎 Файл](${a.content})`;
  }

  const fileName = a.content.slice(0, nl).trim();
  const url = a.content.slice(nl + 1).trim();
  const isImage = /\.(jpe?g|png|gif|webp|heic|bmp)$/i.test(fileName);
  const icon = isImage ? '🖼' : '📎';

  return `  ${index + 1}. [${icon} ${esc(fileName)}](${url})`;
}

async function fetchAdmins(): Promise<User[]> {
  const { data, error } = await supabase
    .from('users')
    .select('id, telegram_id, role, first_name, username, hourly_rate, created_at')
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

    const employeeName = esc(getDisplayName(employee));
    const timeStr = esc(formatTimeSpent(totalTime));

    // Salary line — only if employee has an hourly rate and worked some time
    let salaryLine = '';
    if (employee.hourly_rate && totalTime.totalMinutes > 0) {
      const earned = (totalTime.totalMinutes / 60) * employee.hourly_rate;
      // Show one decimal to be consistent with the dashboard display
      const earnedStr = earned % 1 < 0.05 ? Math.round(earned).toString() : earned.toFixed(1);
      salaryLine = `\n💰 *Заробіток:* ~${earnedStr} грн _(${employee.hourly_rate} грн/год)_`;
    }

    // Separate comments from file attachments
    const comments = attachments.filter((a) => a.type === 'text');
    const files = attachments.filter((a) => a.type === 'file');

    let text =
      `✅ *Задачу завершено*\n\n` +
      `👤 *Співробітник:* ${employeeName}\n` +
      `📌 *Задача:* ${esc(task.name)}\n` +
      `📁 *Проєкт:* ${esc(project.name)}\n` +
      `⏱ *Витрачено:* ${timeStr}` +
      salaryLine;

    if (comments.length > 0) {
      text += `\n\n💬 *Коментар:*`;
      for (const c of comments) {
        const display = esc(c.content.replace(/^💬\s*/, '').trim());
        text += `\n${display}`;
      }
    }

    if (files.length > 0) {
      text += `\n\n📎 *Вкладення (${files.length}):*`;
      files.forEach((a, i) => {
        text += `\n${formatAttachment(a, i)}`;
      });
    }

    await Promise.all(admins.map((admin) => sendToAdmin(admin, text)));
  },
};
