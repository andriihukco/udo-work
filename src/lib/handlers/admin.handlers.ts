/**
 * Admin handlers for the Telegram Time Tracker bot.
 * Requirements: 2.1–2.4, 9.1–9.4, 10.1–10.5
 */

import * as telegramClient from '@/lib/telegram/client';
import { projectService } from '@/lib/services/project.service';
import { taskService } from '@/lib/services/task.service';
import { userService } from '@/lib/services/user.service';
import { membershipService } from '@/lib/services/membership.service';
import { sessionService } from '@/lib/services/session.service';
import { storageService } from '@/lib/services/storage.service';
import { MESSAGES } from '@/lib/messages';
import { logger } from '@/lib/utils/logger';
import { formatTimeSpent, formatDateTime, getStartOfWeek } from '@/lib/utils/time';
import {
  buildProjectKeyboard,
  buildEmployeeListKeyboard,
  buildTaskListKeyboard,
  buildPaginationKeyboard,
  buildFilterKeyboard,
  buildAdminListKeyboard,
  buildInviteRoleKeyboard,
  ADMIN_MAIN_MENU,
  MANAGE_USERS_KEYBOARD,
} from '@/lib/telegram/keyboards';
import { DuplicateProjectError } from '@/types/index';
import type { HandlerContext, TimeSpent, TelegramMessage } from '@/types/index';

const PAGE_SIZE = 10;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function sendDbError(chatId: number, err: unknown): Promise<void> {
  logger.error('Admin handler: database error', err);
  await telegramClient.sendMessage(chatId, MESSAGES.DB_ERROR);
}

function esc(text: string): string {
  return text.replace(/[_*`[\]]/g, (c) => '\\' + c);
}

function statusEmoji(status: string): string {
  return status === 'in_progress' ? '▶️' : status === 'paused' ? '⏸' : '✅';
}

function statusLabel(status: string): string {
  return status === 'in_progress' ? 'В роботі' : status === 'paused' ? 'На паузі' : 'Завершено';
}

/** Edit message if messageId present, otherwise send new. */
async function reply(
  chatId: number,
  messageId: number | undefined,
  text: string,
  options: Parameters<typeof telegramClient.sendMessage>[2] = {},
): Promise<void> {
  if (messageId) {
    await telegramClient.editMessageText(chatId, messageId, text, options).catch(async () => {
      // If edit fails (e.g. message too old), fall back to new message
      await telegramClient.sendMessage(chatId, text, options);
    });
  } else {
    await telegramClient.sendMessage(chatId, text, options);
  }
}

// ---------------------------------------------------------------------------
// 2. Project management
// ---------------------------------------------------------------------------

export async function handleCreateProject(ctx: HandlerContext): Promise<void> {
  const { user, chatId, messageId } = ctx;
  try {
    await sessionService.setState(user.id, 'awaiting_project_name');
    await reply(chatId, messageId, '📁 Введіть назву нового проєкту:\n\n_Або натисніть /cancel для скасування_', {
      parse_mode: 'Markdown',
    });
  } catch (err) {
    await sendDbError(chatId, err);
  }
}

export async function handleProjectNameInput(ctx: HandlerContext, text: string): Promise<void> {
  const { user, chatId } = ctx;
  try {
    const project = await projectService.createProject(text.trim());
    await sessionService.resetSession(user.id);
    await telegramClient.sendMessage(chatId, MESSAGES.PROJECT_CREATED(esc(project.name)), {
      parse_mode: 'Markdown',
      reply_markup: ADMIN_MAIN_MENU,
    });
  } catch (err) {
    if (err instanceof DuplicateProjectError) {
      await telegramClient.sendMessage(chatId, MESSAGES.DUPLICATE_PROJECT);
    } else {
      await sessionService.resetSession(user.id);
      await sendDbError(chatId, err);
    }
  }
}

export async function handleDeactivateProject(ctx: HandlerContext): Promise<void> {
  const { chatId, messageId } = ctx;
  try {
    const projects = await projectService.getActiveProjects();
    if (projects.length === 0) {
      await reply(chatId, messageId, MESSAGES.NO_ACTIVE_PROJECTS, { reply_markup: ADMIN_MAIN_MENU });
      return;
    }
    await reply(chatId, messageId, '🚫 Оберіть проєкт для деактивації:', {
      reply_markup: buildProjectKeyboard(projects, 'action:back_to_main'),
    });
  } catch (err) {
    await sendDbError(chatId, err);
  }
}

export async function handleDeactivateProjectConfirm(ctx: HandlerContext, projectId: string): Promise<void> {
  const { user, chatId, messageId } = ctx;
  try {
    const project = await projectService.findById(projectId);
    if (!project) {
      await reply(chatId, messageId, MESSAGES.NO_ACTIVE_PROJECTS, { reply_markup: ADMIN_MAIN_MENU });
      return;
    }
    await projectService.deactivateProject(projectId);
    await sessionService.resetSession(user.id);
    await reply(chatId, messageId, MESSAGES.PROJECT_DEACTIVATED(esc(project.name)), {
      parse_mode: 'Markdown',
      reply_markup: ADMIN_MAIN_MENU,
    });
  } catch (err) {
    await sendDbError(chatId, err);
  }
}

// ---------------------------------------------------------------------------
// 9. Employees
// ---------------------------------------------------------------------------

export async function handleEmployees(ctx: HandlerContext): Promise<void> {
  const { chatId, messageId } = ctx;
  try {
    const employees = await userService.getAllEmployeesWithWeeklyTime();
    if (employees.length === 0) {
      await reply(chatId, messageId, '👥 Співробітників не знайдено.', { reply_markup: ADMIN_MAIN_MENU });
      return;
    }
    const lines = ['👥 *Співробітники (поточний тиждень):*\n'];
    for (const emp of employees) {
      const name = userService.getDisplayName(emp);
      const t: TimeSpent = { hours: Math.floor(emp.weeklyMinutes / 60), minutes: emp.weeklyMinutes % 60, totalMinutes: emp.weeklyMinutes };
      lines.push(`👤 *${esc(name)}:* ${formatTimeSpent(t)}`);
    }
    await reply(chatId, messageId, lines.join('\n'), {
      parse_mode: 'Markdown',
      reply_markup: buildEmployeeListKeyboard(employees, 'action:back_to_main'),
    });
  } catch (err) {
    await sendDbError(chatId, err);
  }
}

export async function handleEmployeeDetail(ctx: HandlerContext, userId: string): Promise<void> {
  const { chatId, messageId } = ctx;
  try {
    const [activities, employees] = await Promise.all([
      taskService.getTasksForUser(userId, getStartOfWeek(), new Date()),
      userService.getAllEmployeesWithWeeklyTime(),
    ]);
    const employee = employees.find((e) => e.id === userId);
    const name = employee ? userService.getDisplayName(employee) : userId;
    const back = { inline_keyboard: [[{ text: '◀️ Назад', callback_data: 'action:employees' }]] };

    if (activities.length === 0) {
      await reply(chatId, messageId, `👤 *${esc(name)}*\n\n📭 За поточний тиждень задач не знайдено.`, {
        parse_mode: 'Markdown', reply_markup: back,
      });
      return;
    }

    const lines = [`👤 *${esc(name)} — задачі за тиждень:*\n`];
    for (const a of activities) {
      lines.push(`${statusEmoji(a.status)} *${esc(a.taskName)}*\n   📁 ${esc(a.projectName)}\n   📊 ${statusLabel(a.status)}\n   ⏱ ${formatTimeSpent(a.timeSpent)}\n`);
    }
    const totalMin = activities.reduce((s, a) => s + a.timeSpent.totalMinutes, 0);
    lines.push(`\n*Загалом за тиждень:* ${formatTimeSpent({ hours: Math.floor(totalMin / 60), minutes: totalMin % 60, totalMinutes: totalMin })}`);

    await reply(chatId, messageId, lines.join('\n'), { parse_mode: 'Markdown', reply_markup: back });
  } catch (err) {
    await sendDbError(chatId, err);
  }
}

// ---------------------------------------------------------------------------
// 10. Tasks & Logs
// ---------------------------------------------------------------------------

export async function handleTasksLogs(ctx: HandlerContext): Promise<void> {
  const { chatId, messageId } = ctx;
  await reply(chatId, messageId, '📋 Оберіть фільтр для перегляду задач:', { reply_markup: buildFilterKeyboard() });
}

export async function handleTasksFilter(ctx: HandlerContext, filter: string): Promise<void> {
  const { chatId, messageId } = ctx;
  try {
    if (filter === 'all') {
      const { tasks, total } = await taskService.getTasksWithFilters({}, 0);
      if (tasks.length === 0) {
        await reply(chatId, messageId, '📭 Задач не знайдено.', { reply_markup: buildFilterKeyboard() });
        return;
      }
      const totalPages = Math.ceil(total / PAGE_SIZE);
      const pagination = buildPaginationKeyboard(0, totalPages, 'tasks');
      await reply(chatId, messageId, `📋 *Всі задачі* (${total}):`, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            ...buildTaskListKeyboard(tasks, 'action:tasks_logs').inline_keyboard,
            ...pagination.inline_keyboard,
          ],
        },
      });
    } else if (filter === 'by_project') {
      const projects = await projectService.getActiveProjects();
      if (projects.length === 0) {
        await reply(chatId, messageId, MESSAGES.NO_ACTIVE_PROJECTS, { reply_markup: buildFilterKeyboard() });
        return;
      }
      await reply(chatId, messageId, '📁 Оберіть проєкт:', {
        reply_markup: buildProjectKeyboard(projects, 'action:tasks_logs'),
      });
    } else if (filter === 'by_employee') {
      const employees = await userService.getAllEmployeesWithWeeklyTime();
      if (employees.length === 0) {
        await reply(chatId, messageId, '👥 Співробітників не знайдено.', { reply_markup: buildFilterKeyboard() });
        return;
      }
      await reply(chatId, messageId, '👤 Оберіть співробітника:', {
        reply_markup: buildEmployeeListKeyboard(employees, 'action:tasks_logs'),
      });
    }
  } catch (err) {
    await sendDbError(chatId, err);
  }
}

export async function handleTaskDetail(ctx: HandlerContext, taskId: string): Promise<void> {
  const { chatId, messageId } = ctx;
  try {
    const [timeLogs, attachments] = await Promise.all([
      taskService.getTimeLogs(taskId),
      storageService.getAttachments(taskId),
    ]);
    const lines = ['📋 *Деталі задачі:*\n'];
    if (timeLogs.length === 0) {
      lines.push('⏱ *Логи часу:* відсутні\n');
    } else {
      lines.push('⏱ *Логи часу:*');
      for (let i = 0; i < timeLogs.length; i++) {
        const log = timeLogs[i];
        lines.push(`\n*Інтервал ${i + 1}:*`);
        lines.push(`  🟢 Старт: ${formatDateTime(log.started_at)}`);
        if (log.paused_at) lines.push(`  ⏸ Пауза: ${formatDateTime(log.paused_at)}`);
        if (log.ended_at) lines.push(`  🔴 Завершено: ${formatDateTime(log.ended_at)}`);
        if (!log.paused_at && !log.ended_at) lines.push(`  ▶️ (активний)`);
      }
    }
    if (attachments.length > 0) {
      lines.push('\n📎 *Результати:*');
      for (const a of attachments) {
        lines.push(a.type === 'text' ? `  📝 ${esc(a.content)}` : `  📄 [Файл](${a.content})`);
      }
    }
    const back = { inline_keyboard: [[{ text: '◀️ Назад', callback_data: 'action:tasks_logs' }]] };
    await reply(chatId, messageId, lines.join('\n'), { parse_mode: 'Markdown', reply_markup: back });
  } catch (err) {
    await sendDbError(chatId, err);
  }
}

export async function handlePagination(ctx: HandlerContext, prefix: string, page: number): Promise<void> {
  const { chatId, messageId } = ctx;
  try {
    if (prefix === 'tasks') {
      const { tasks, total } = await taskService.getTasksWithFilters({}, page);
      const totalPages = Math.ceil(total / PAGE_SIZE);
      const pagination = buildPaginationKeyboard(page, totalPages, 'tasks');
      await reply(chatId, messageId, `📋 *Всі задачі* (${total}), стор. ${page + 1}/${totalPages}:`, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [...buildTaskListKeyboard(tasks, 'action:tasks_logs').inline_keyboard, ...pagination.inline_keyboard] },
      });
    } else if (prefix.startsWith('filter_project:')) {
      const projectId = prefix.slice('filter_project:'.length);
      const { tasks, total } = await taskService.getTasksWithFilters({ projectId }, page);
      const totalPages = Math.ceil(total / PAGE_SIZE);
      const pagination = buildPaginationKeyboard(page, totalPages, prefix);
      await reply(chatId, messageId, `📁 *Задачі за проєктом* (${total}), стор. ${page + 1}/${totalPages}:`, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [...buildTaskListKeyboard(tasks, 'action:tasks_logs').inline_keyboard, ...pagination.inline_keyboard] },
      });
    } else if (prefix.startsWith('filter_employee:')) {
      const userId = prefix.slice('filter_employee:'.length);
      const { tasks, total } = await taskService.getTasksWithFilters({ userId }, page);
      const totalPages = Math.ceil(total / PAGE_SIZE);
      const pagination = buildPaginationKeyboard(page, totalPages, prefix);
      await reply(chatId, messageId, `👤 *Задачі за співробітником* (${total}), стор. ${page + 1}/${totalPages}:`, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [...buildTaskListKeyboard(tasks, 'action:tasks_logs').inline_keyboard, ...pagination.inline_keyboard] },
      });
    }
  } catch (err) {
    await sendDbError(chatId, err);
  }
}

export async function handleProjectTasksFilter(ctx: HandlerContext, projectId: string): Promise<void> {
  const { chatId, messageId } = ctx;
  try {
    const [project, { tasks, total }] = await Promise.all([
      projectService.findById(projectId),
      taskService.getTasksWithFilters({ projectId }, 0),
    ]);
    const name = project?.name ?? projectId;
    if (tasks.length === 0) {
      await reply(chatId, messageId, `📁 *${esc(name)}*\n\n📭 Задач не знайдено.`, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '◀️ Назад', callback_data: 'action:tasks_logs' }]] },
      });
      return;
    }
    const totalPages = Math.ceil(total / PAGE_SIZE);
    const pagination = buildPaginationKeyboard(0, totalPages, `filter_project:${projectId}`);
    await reply(chatId, messageId, `📁 *${esc(name)}* — задачі (${total}):`, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [...buildTaskListKeyboard(tasks, 'action:tasks_logs').inline_keyboard, ...pagination.inline_keyboard] },
    });
  } catch (err) {
    await sendDbError(chatId, err);
  }
}

export async function handleEmployeeTasksFilter(ctx: HandlerContext, userId: string): Promise<void> {
  const { chatId, messageId } = ctx;
  try {
    const [{ tasks, total }, employees] = await Promise.all([
      taskService.getTasksWithFilters({ userId }, 0),
      userService.getAllEmployeesWithWeeklyTime(),
    ]);
    const employee = employees.find((e) => e.id === userId);
    const name = employee ? userService.getDisplayName(employee) : userId;
    if (tasks.length === 0) {
      await reply(chatId, messageId, `👤 *${esc(name)}*\n\n📭 Задач не знайдено.`, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '◀️ Назад', callback_data: 'action:tasks_logs' }]] },
      });
      return;
    }
    const totalPages = Math.ceil(total / PAGE_SIZE);
    const pagination = buildPaginationKeyboard(0, totalPages, `filter_employee:${userId}`);
    await reply(chatId, messageId, `👤 *${esc(name)}* — задачі (${total}):`, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: [...buildTaskListKeyboard(tasks, 'action:tasks_logs').inline_keyboard, ...pagination.inline_keyboard] },
    });
  } catch (err) {
    await sendDbError(chatId, err);
  }
}

// ---------------------------------------------------------------------------
// Admin / user management
// ---------------------------------------------------------------------------

export async function handleManageAdmins(ctx: HandlerContext): Promise<void> {
  const { chatId, messageId } = ctx;
  await reply(chatId, messageId, MESSAGES.MANAGE_USERS_PROMPT, { reply_markup: MANAGE_USERS_KEYBOARD });
}

export async function handleAddAdmin(ctx: HandlerContext): Promise<void> {
  const { user, chatId, messageId } = ctx;
  try {
    await sessionService.setState(user.id, 'awaiting_new_admin_id');
    await reply(chatId, messageId, MESSAGES.ADD_ADMIN_PROMPT, { parse_mode: 'Markdown' });
  } catch (err) {
    await sendDbError(chatId, err);
  }
}

export async function handleAddEmployee(ctx: HandlerContext): Promise<void> {
  const { user, chatId, messageId } = ctx;
  try {
    await sessionService.setState(user.id, 'awaiting_new_employee_id');
    await reply(chatId, messageId, MESSAGES.ADD_EMPLOYEE_PROMPT, { parse_mode: 'Markdown' });
  } catch (err) {
    await sendDbError(chatId, err);
  }
}

async function resolveUserFromMessage(message: TelegramMessage): Promise<{ telegramId: number; firstName?: string; username?: string; privacyBlocked?: boolean } | null> {
  // 1. New Bot API: forward_origin with sender_user (privacy allowed)
  if (message.forward_origin?.type === 'user' && message.forward_origin.sender_user) {
    return {
      telegramId: message.forward_origin.sender_user.id,
      firstName: message.forward_origin.sender_user.first_name,
      username: message.forward_origin.sender_user.username,
    };
  }

  // 2. Old Bot API: forward_from (privacy allowed)
  if (message.forward_from) {
    return {
      telegramId: message.forward_from.id,
      firstName: message.forward_from.first_name,
      username: message.forward_from.username,
    };
  }

  // 3. Forward with privacy enabled — sender hid their identity
  // forward_origin.type = 'hidden_user' or forward_sender_name is set
  if (
    message.forward_origin?.type === 'hidden_user' ||
    message.forward_sender_name ||
    (message.forward_origin && !message.forward_origin.sender_user)
  ) {
    const name = message.forward_origin?.sender_user_name ?? message.forward_sender_name ?? 'невідомий';
    return { telegramId: 0, firstName: name, privacyBlocked: true };
  }

  const text = (message.text ?? '').trim();

  // 4. @username text input
  if (text.startsWith('@')) {
    return { telegramId: 0, username: text.slice(1) };
  }

  // 5. Numeric ID text input
  const id = parseInt(text, 10);
  if (!isNaN(id) && id > 0) {
    return { telegramId: id };
  }

  return null;
}

export async function handleNewAdminIdInput(ctx: HandlerContext, message: TelegramMessage): Promise<void> {
  await handleAddUserInput(ctx, message, 'admin');
}

export async function handleNewEmployeeIdInput(ctx: HandlerContext, message: TelegramMessage): Promise<void> {
  await handleAddUserInput(ctx, message, 'employee');
}

async function handleAddUserInput(ctx: HandlerContext, message: TelegramMessage, role: 'admin' | 'employee'): Promise<void> {
  const { user, chatId } = ctx;
  const backKeyboard = { inline_keyboard: [[{ text: '◀️ Назад', callback_data: 'action:manage_admins' }]] };

  const resolved = await resolveUserFromMessage(message);

  if (!resolved) {
    await telegramClient.sendMessage(chatId, MESSAGES.INVALID_TELEGRAM_ID, { reply_markup: backKeyboard });
    return;
  }

  if (resolved.telegramId === 0) {
    if (resolved.privacyBlocked) {
      const name = resolved.firstName ?? 'цей користувач';
      await telegramClient.sendMessage(
        chatId,
        `🔒 *${esc(name)}* приховав свій профіль у налаштуваннях конфіденційності Telegram.\n\n` +
        `Попросіть їх:\n1. Написати боту команду /start\n2. Або вимкнути "Пересилання повідомлень → Ніхто" у налаштуваннях Telegram\n\nАбо введіть їх числовий ID вручну.`,
        { parse_mode: 'Markdown', reply_markup: backKeyboard },
      );
    } else {
      await telegramClient.sendMessage(
        chatId,
        `⚠️ Не вдалося отримати Telegram ID для @${resolved.username}.\n\n` +
        `Попросіть цю людину написати боту /start, а потім перешліть їхнє повідомлення сюди.`,
        { reply_markup: backKeyboard },
      );
    }
    return;
  }

  try {
    const existing = await userService.findByTelegramId(resolved.telegramId);
    if (existing) {
      await telegramClient.sendMessage(
        chatId,
        `⚠️ Вже зареєстрований як *${existing.role === 'admin' ? 'адмін' : 'співробітник'}*: ${esc(userService.getDisplayName(existing))}`,
        { parse_mode: 'Markdown', reply_markup: backKeyboard },
      );
      return;
    }

    await userService.createUser(resolved.telegramId, role, resolved.firstName, resolved.username);
    await sessionService.resetSession(user.id);

    const displayName = resolved.firstName ?? (resolved.username ? `@${resolved.username}` : String(resolved.telegramId));
    const msg = role === 'admin' ? MESSAGES.USER_ADDED_ADMIN(resolved.telegramId) : MESSAGES.USER_ADDED_EMPLOYEE(resolved.telegramId);
    await telegramClient.sendMessage(chatId, `${msg}\n👤 ${esc(displayName)}`, {
      parse_mode: 'Markdown',
      reply_markup: ADMIN_MAIN_MENU,
    });
  } catch (err) {
    await sessionService.resetSession(user.id);
    await sendDbError(chatId, err);
  }
}

export async function handleRemoveAdmin(ctx: HandlerContext): Promise<void> {
  const { user, chatId, messageId } = ctx;
  try {
    const admins = await userService.getAllAdmins();
    const others = admins.filter((a) => a.id !== user.id);
    if (others.length === 0) {
      await reply(chatId, messageId, MESSAGES.NO_ADMINS_TO_REMOVE, { reply_markup: MANAGE_USERS_KEYBOARD });
      return;
    }
    await reply(chatId, messageId, '🗑 Оберіть адміна для видалення:', { reply_markup: buildAdminListKeyboard(others) });
  } catch (err) {
    await sendDbError(chatId, err);
  }
}

export async function handleRemoveAdminConfirm(ctx: HandlerContext, targetUserId: string): Promise<void> {
  const { user, chatId, messageId } = ctx;
  if (targetUserId === user.id) {
    await reply(chatId, messageId, MESSAGES.CANNOT_REMOVE_SELF, { reply_markup: MANAGE_USERS_KEYBOARD });
    return;
  }
  try {
    const admins = await userService.getAllAdmins();
    const target = admins.find((a) => a.id === targetUserId);
    if (!target) {
      await reply(chatId, messageId, '⚠️ Адміна не знайдено.', { reply_markup: MANAGE_USERS_KEYBOARD });
      return;
    }
    await userService.deleteUser(targetUserId);
    await reply(chatId, messageId, MESSAGES.ADMIN_REMOVED(esc(userService.getDisplayName(target))), {
      parse_mode: 'Markdown',
      reply_markup: ADMIN_MAIN_MENU,
    });
  } catch (err) {
    await sendDbError(chatId, err);
  }
}

// ---------------------------------------------------------------------------
// Invite links
// ---------------------------------------------------------------------------

/** Shows project selection for generating an invite link. */
export async function handleInviteToProject(ctx: HandlerContext): Promise<void> {
  const { chatId, messageId } = ctx;
  try {
    const projects = await projectService.getActiveProjects();
    if (projects.length === 0) {
      await reply(chatId, messageId, MESSAGES.NO_ACTIVE_PROJECTS, { reply_markup: ADMIN_MAIN_MENU });
      return;
    }
    await reply(chatId, messageId, '🔗 Оберіть проєкт для генерації запрошення:', {
      reply_markup: buildProjectKeyboard(projects, 'action:back_to_main', 'invite_project'),
    });
  } catch (err) {
    await sendDbError(chatId, err);
  }
}

/** Shows role selection after project is chosen for invite. */
export async function handleInviteProjectSelected(ctx: HandlerContext, projectId: string): Promise<void> {
  const { chatId, messageId } = ctx;
  try {
    const project = await projectService.findById(projectId);
    if (!project) {
      await reply(chatId, messageId, '⚠️ Проєкт не знайдено.', { reply_markup: ADMIN_MAIN_MENU });
      return;
    }
    await reply(chatId, messageId, `🔗 *${esc(project.name)}*\n\nОберіть роль для запрошення:`, {
      parse_mode: 'Markdown',
      reply_markup: buildInviteRoleKeyboard(projectId),
    });
  } catch (err) {
    await sendDbError(chatId, err);
  }
}

/** Generates and sends the invite link. */
export async function handleGenerateInviteLink(ctx: HandlerContext, projectId: string, role: 'admin' | 'employee'): Promise<void> {
  const { user, chatId, messageId } = ctx;
  try {
    const project = await projectService.findById(projectId);
    if (!project) {
      await reply(chatId, messageId, '⚠️ Проєкт не знайдено.', { reply_markup: ADMIN_MAIN_MENU });
      return;
    }

    const link = await membershipService.createInviteLink(projectId, role, user.id);
    const roleLabel = role === 'admin' ? 'адміна' : 'співробітника';

    await reply(chatId, messageId,
      `🔗 *Посилання-запрошення*\n\n` +
      `📁 Проєкт: *${esc(project.name)}*\n` +
      `👤 Роль: *${roleLabel}*\n` +
      `⏳ Дійсне: 7 днів\n\n` +
      `${link}\n\n` +
      `_Надішліть це посилання потрібній людині. Після переходу вони автоматично отримають доступ._`,
      { parse_mode: 'Markdown', reply_markup: ADMIN_MAIN_MENU },
    );
  } catch (err) {
    await sendDbError(chatId, err);
  }
}
