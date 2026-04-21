/**
 * Admin handlers for the Telegram Time Tracker bot.
 *
 * Implements all admin-facing conversation flows:
 *  - Create project (name input flow)
 *  - Deactivate project (project selection)
 *  - View employees with weekly hours
 *  - View employee detail (tasks for current week)
 *  - View tasks & logs (filter → list → detail)
 *  - Pagination for long lists
 *
 * Requirements: 2.1–2.4, 9.1–9.4, 10.1–10.5
 */

import * as telegramClient from '@/lib/telegram/client';
import { projectService } from '@/lib/services/project.service';
import { taskService } from '@/lib/services/task.service';
import { userService } from '@/lib/services/user.service';
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
  ADMIN_MAIN_MENU,
} from '@/lib/telegram/keyboards';
import { DuplicateProjectError } from '@/types/index';
import type {
  HandlerContext,
  TimeSpent,
} from '@/types/index';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 10;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Sends a generic database error message to the user and logs the error.
 */
async function sendDbError(chatId: number, err: unknown): Promise<void> {
  logger.error('Admin handler: database error', err);
  await telegramClient.sendMessage(chatId, MESSAGES.DB_ERROR);
}

/**
 * Escapes special Markdown characters in user-provided strings to prevent
 * formatting issues in Telegram messages.
 */
function escapeMarkdown(text: string): string {
  return text.replace(/[_*`[\]]/g, '\\$&');
}

/**
 * Returns an emoji for a task status.
 */
function getStatusEmoji(status: string): string {
  switch (status) {
    case 'in_progress': return '▶️';
    case 'paused': return '⏸';
    case 'completed': return '✅';
    default: return '•';
  }
}

/**
 * Returns a Ukrainian label for a task status.
 */
function getStatusLabel(status: string): string {
  switch (status) {
    case 'in_progress': return 'В роботі';
    case 'paused': return 'На паузі';
    case 'completed': return 'Завершено';
    default: return status;
  }
}

// ---------------------------------------------------------------------------
// 2. Project management
// ---------------------------------------------------------------------------

/**
 * Entry point for the "create project" flow.
 * Sets session state to `awaiting_project_name` and prompts for a name.
 * Req 2.1
 */
export async function handleCreateProject(ctx: HandlerContext): Promise<void> {
  const { user, chatId } = ctx;

  try {
    await sessionService.setState(user.id, 'awaiting_project_name');
    await telegramClient.sendMessage(
      chatId,
      '📁 Введіть назву нового проєкту:',
    );
  } catch (err) {
    await sendDbError(chatId, err);
  }
}

/**
 * Called when the admin types a project name while in `awaiting_project_name` state.
 * Creates the project, sends success or duplicate error message, resets session.
 * Req 2.1, 2.2
 */
export async function handleProjectNameInput(
  ctx: HandlerContext,
  text: string,
): Promise<void> {
  const { user, chatId } = ctx;

  try {
    const project = await projectService.createProject(text.trim());

    await sessionService.resetSession(user.id);

    await telegramClient.sendMessage(
      chatId,
      MESSAGES.PROJECT_CREATED(project.name),
      {
        parse_mode: 'Markdown',
        reply_markup: ADMIN_MAIN_MENU,
      },
    );
  } catch (err) {
    if (err instanceof DuplicateProjectError) {
      // Keep session in awaiting_project_name so admin can try again
      await telegramClient.sendMessage(chatId, MESSAGES.DUPLICATE_PROJECT);
    } else {
      await sessionService.resetSession(user.id);
      await sendDbError(chatId, err);
    }
  }
}

/**
 * Entry point for the "deactivate project" flow.
 * Fetches active projects and sends a project selection keyboard.
 * Req 2.3
 */
export async function handleDeactivateProject(ctx: HandlerContext): Promise<void> {
  const { chatId } = ctx;

  try {
    const projects = await projectService.getActiveProjects();

    if (projects.length === 0) {
      await telegramClient.sendMessage(chatId, MESSAGES.NO_ACTIVE_PROJECTS);
      return;
    }

    await telegramClient.sendMessage(
      chatId,
      '🚫 Оберіть проєкт для деактивації:',
      { reply_markup: buildProjectKeyboard(projects) },
    );
  } catch (err) {
    await sendDbError(chatId, err);
  }
}

/**
 * Called when the admin selects a project to deactivate.
 * Deactivates the project, sends confirmation, resets session.
 * Req 2.3
 */
export async function handleDeactivateProjectConfirm(
  ctx: HandlerContext,
  projectId: string,
): Promise<void> {
  const { user, chatId } = ctx;

  try {
    const project = await projectService.findById(projectId);
    if (!project) {
      await telegramClient.sendMessage(chatId, MESSAGES.NO_ACTIVE_PROJECTS);
      return;
    }

    await projectService.deactivateProject(projectId);
    await sessionService.resetSession(user.id);

    await telegramClient.sendMessage(
      chatId,
      MESSAGES.PROJECT_DEACTIVATED(project.name),
      {
        parse_mode: 'Markdown',
        reply_markup: ADMIN_MAIN_MENU,
      },
    );
  } catch (err) {
    await sendDbError(chatId, err);
  }
}

// ---------------------------------------------------------------------------
// 9. Employees
// ---------------------------------------------------------------------------

/**
 * Shows all employees with their total weekly hours.
 * Req 9.1
 */
export async function handleEmployees(ctx: HandlerContext): Promise<void> {
  const { chatId } = ctx;

  try {
    const employees = await userService.getAllEmployeesWithWeeklyTime();

    if (employees.length === 0) {
      await telegramClient.sendMessage(chatId, '👥 Співробітників не знайдено.');
      return;
    }

    const lines: string[] = ['👥 *Співробітники (поточний тиждень):*\n'];

    for (const emp of employees) {
      const displayName = userService.getDisplayName(emp);
      const timeSpent: TimeSpent = {
        hours: Math.floor(emp.weeklyMinutes / 60),
        minutes: emp.weeklyMinutes % 60,
        totalMinutes: emp.weeklyMinutes,
      };
      lines.push(`👤 *${escapeMarkdown(displayName)}:* ${formatTimeSpent(timeSpent)}`);
    }

    await telegramClient.sendMessage(chatId, lines.join('\n'), {
      parse_mode: 'Markdown',
      reply_markup: buildEmployeeListKeyboard(employees),
    });
  } catch (err) {
    await sendDbError(chatId, err);
  }
}

/**
 * Shows detailed task report for a specific employee for the current week.
 * Req 9.2
 */
export async function handleEmployeeDetail(
  ctx: HandlerContext,
  userId: string,
): Promise<void> {
  const { chatId } = ctx;

  try {
    const startOfWeek = getStartOfWeek();
    const now = new Date();

    const activities = await taskService.getTasksForUser(userId, startOfWeek, now);

    // Fetch the employee's display name
    const employees = await userService.getAllEmployeesWithWeeklyTime();
    const employee = employees.find((e) => e.id === userId);
    const displayName = employee ? userService.getDisplayName(employee) : userId;

    if (activities.length === 0) {
      await telegramClient.sendMessage(
        chatId,
        `👤 *${escapeMarkdown(displayName)}*\n\n📭 За поточний тиждень задач не знайдено.`,
        { parse_mode: 'Markdown' },
      );
      return;
    }

    const lines: string[] = [
      `👤 *${escapeMarkdown(displayName)} — задачі за тиждень:*\n`,
    ];

    for (const activity of activities) {
      const statusEmoji = getStatusEmoji(activity.status);
      const statusLabel = getStatusLabel(activity.status);
      lines.push(
        `${statusEmoji} *${escapeMarkdown(activity.taskName)}*\n` +
        `   📁 ${escapeMarkdown(activity.projectName)}\n` +
        `   📊 ${statusLabel}\n` +
        `   ⏱ ${formatTimeSpent(activity.timeSpent)}\n`,
      );
    }

    const totalMinutes = activities.reduce((sum, a) => sum + a.timeSpent.totalMinutes, 0);
    const totalTime: TimeSpent = {
      hours: Math.floor(totalMinutes / 60),
      minutes: totalMinutes % 60,
      totalMinutes,
    };

    lines.push(`\n*Загалом за тиждень:* ${formatTimeSpent(totalTime)}`);

    await telegramClient.sendMessage(chatId, lines.join('\n'), {
      parse_mode: 'Markdown',
    });
  } catch (err) {
    await sendDbError(chatId, err);
  }
}

// ---------------------------------------------------------------------------
// 10. Tasks & Logs
// ---------------------------------------------------------------------------

/**
 * Entry point for the "tasks & logs" flow.
 * Sends the filter selection keyboard.
 * Req 10.1
 */
export async function handleTasksLogs(ctx: HandlerContext): Promise<void> {
  const { chatId } = ctx;

  await telegramClient.sendMessage(
    chatId,
    '📋 Оберіть фільтр для перегляду задач:',
    { reply_markup: buildFilterKeyboard() },
  );
}

/**
 * Routes to the appropriate sub-flow based on the selected filter.
 * - 'all' → fetch all tasks paginated, send list
 * - 'by_project' → fetch active projects, send project selection keyboard
 * - 'by_employee' → fetch all employees, send employee selection keyboard
 * Req 10.1, 10.2, 10.3
 */
export async function handleTasksFilter(
  ctx: HandlerContext,
  filter: string,
): Promise<void> {
  const { chatId } = ctx;

  try {
    if (filter === 'all') {
      const { tasks, total } = await taskService.getTasksWithFilters({}, 0);

      if (tasks.length === 0) {
        await telegramClient.sendMessage(chatId, '📭 Задач не знайдено.');
        return;
      }

      const totalPages = Math.ceil(total / PAGE_SIZE);
      const paginationKeyboard = buildPaginationKeyboard(0, totalPages, 'tasks');

      await telegramClient.sendMessage(
        chatId,
        `📋 *Всі задачі* (${total}):`,
        {
          parse_mode: 'Markdown',
          reply_markup: tasks.length > 0
            ? {
                inline_keyboard: [
                  ...buildTaskListKeyboard(tasks).inline_keyboard,
                  ...paginationKeyboard.inline_keyboard,
                ],
              }
            : buildTaskListKeyboard(tasks),
        },
      );
    } else if (filter === 'by_project') {
      const projects = await projectService.getActiveProjects();

      if (projects.length === 0) {
        await telegramClient.sendMessage(chatId, MESSAGES.NO_ACTIVE_PROJECTS);
        return;
      }

      await telegramClient.sendMessage(
        chatId,
        '📁 Оберіть проєкт:',
        { reply_markup: buildProjectKeyboard(projects) },
      );
    } else if (filter === 'by_employee') {
      const employees = await userService.getAllEmployeesWithWeeklyTime();

      if (employees.length === 0) {
        await telegramClient.sendMessage(chatId, '👥 Співробітників не знайдено.');
        return;
      }

      await telegramClient.sendMessage(
        chatId,
        '👤 Оберіть співробітника:',
        { reply_markup: buildEmployeeListKeyboard(employees) },
      );
    } else {
      logger.warn('handleTasksFilter: unknown filter', filter);
    }
  } catch (err) {
    await sendDbError(chatId, err);
  }
}

/**
 * Shows full detail for a specific task: time logs and attachments.
 * Req 10.4
 */
export async function handleTaskDetail(
  ctx: HandlerContext,
  taskId: string,
): Promise<void> {
  const { chatId } = ctx;

  try {
    const [timeLogs, attachments] = await Promise.all([
      taskService.getTimeLogs(taskId),
      storageService.getAttachments(taskId),
    ]);

    const lines: string[] = ['📋 *Деталі задачі:*\n'];

    // Time logs section
    if (timeLogs.length === 0) {
      lines.push('⏱ *Логи часу:* відсутні\n');
    } else {
      lines.push('⏱ *Логи часу:*');
      for (let i = 0; i < timeLogs.length; i++) {
        const log = timeLogs[i];
        lines.push(`\n*Інтервал ${i + 1}:*`);
        lines.push(`  🟢 Старт: ${formatDateTime(log.started_at)}`);
        if (log.paused_at) {
          lines.push(`  ⏸ Пауза: ${formatDateTime(log.paused_at)}`);
        }
        if (log.ended_at) {
          lines.push(`  🔴 Завершено: ${formatDateTime(log.ended_at)}`);
        }
        if (!log.paused_at && !log.ended_at) {
          lines.push(`  ▶️ (активний)`);
        }
      }
    }

    // Attachments section
    if (attachments.length > 0) {
      lines.push('\n📎 *Результати:*');
      for (const attachment of attachments) {
        if (attachment.type === 'text') {
          lines.push(`  📝 ${escapeMarkdown(attachment.content)}`);
        } else {
          lines.push(`  📄 [Файл](${attachment.content})`);
        }
      }
    }

    await telegramClient.sendMessage(chatId, lines.join('\n'), {
      parse_mode: 'Markdown',
    });
  } catch (err) {
    await sendDbError(chatId, err);
  }
}

/**
 * Handles pagination for task/employee lists.
 * Re-fetches paginated data and updates the message keyboard.
 * Supported prefixes: 'tasks', 'filter_project:{projectId}', 'filter_employee:{userId}'
 * Req 10.5
 */
export async function handlePagination(
  ctx: HandlerContext,
  prefix: string,
  page: number,
): Promise<void> {
  const { chatId } = ctx;

  try {
    if (prefix === 'tasks') {
      // All tasks paginated
      const { tasks, total } = await taskService.getTasksWithFilters({}, page);
      const totalPages = Math.ceil(total / PAGE_SIZE);
      const paginationKeyboard = buildPaginationKeyboard(page, totalPages, 'tasks');

      await telegramClient.sendMessage(
        chatId,
        `📋 *Всі задачі* (${total}), сторінка ${page + 1}/${totalPages}:`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              ...buildTaskListKeyboard(tasks).inline_keyboard,
              ...paginationKeyboard.inline_keyboard,
            ],
          },
        },
      );
    } else if (prefix.startsWith('filter_project:')) {
      // Tasks filtered by project
      const projectId = prefix.slice('filter_project:'.length);
      const { tasks, total } = await taskService.getTasksWithFilters({ projectId }, page);
      const totalPages = Math.ceil(total / PAGE_SIZE);
      const paginationKeyboard = buildPaginationKeyboard(page, totalPages, prefix);

      await telegramClient.sendMessage(
        chatId,
        `📁 *Задачі за проєктом* (${total}), сторінка ${page + 1}/${totalPages}:`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              ...buildTaskListKeyboard(tasks).inline_keyboard,
              ...paginationKeyboard.inline_keyboard,
            ],
          },
        },
      );
    } else if (prefix.startsWith('filter_employee:')) {
      // Tasks filtered by employee
      const userId = prefix.slice('filter_employee:'.length);
      const { tasks, total } = await taskService.getTasksWithFilters({ userId }, page);
      const totalPages = Math.ceil(total / PAGE_SIZE);
      const paginationKeyboard = buildPaginationKeyboard(page, totalPages, prefix);

      await telegramClient.sendMessage(
        chatId,
        `👤 *Задачі за співробітником* (${total}), сторінка ${page + 1}/${totalPages}:`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              ...buildTaskListKeyboard(tasks).inline_keyboard,
              ...paginationKeyboard.inline_keyboard,
            ],
          },
        },
      );
    } else if (prefix === 'employees') {
      // Employee list pagination (if needed in future)
      const employees = await userService.getAllEmployeesWithWeeklyTime();
      const total = employees.length;
      const totalPages = Math.ceil(total / PAGE_SIZE);
      const pageEmployees = employees.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
      const paginationKeyboard = buildPaginationKeyboard(page, totalPages, 'employees');

      const lines: string[] = [`👥 *Співробітники* (${total}), сторінка ${page + 1}/${totalPages}:\n`];
      for (const emp of pageEmployees) {
        const displayName = userService.getDisplayName(emp);
        const timeSpent: TimeSpent = {
          hours: Math.floor(emp.weeklyMinutes / 60),
          minutes: emp.weeklyMinutes % 60,
          totalMinutes: emp.weeklyMinutes,
        };
        lines.push(`👤 *${escapeMarkdown(displayName)}:* ${formatTimeSpent(timeSpent)}`);
      }

      await telegramClient.sendMessage(chatId, lines.join('\n'), {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            ...buildEmployeeListKeyboard(pageEmployees).inline_keyboard,
            ...paginationKeyboard.inline_keyboard,
          ],
        },
      });
    } else {
      logger.warn('handlePagination: unknown prefix', prefix);
    }
  } catch (err) {
    await sendDbError(chatId, err);
  }
}

/**
 * Shows tasks for a specific project (used in the by_project filter flow).
 * Req 10.2
 */
export async function handleProjectTasksFilter(
  ctx: HandlerContext,
  projectId: string,
): Promise<void> {
  const { chatId } = ctx;

  try {
    const project = await projectService.findById(projectId);
    const { tasks, total } = await taskService.getTasksWithFilters({ projectId }, 0);

    if (tasks.length === 0) {
      const projectName = project?.name ?? projectId;
      await telegramClient.sendMessage(
        chatId,
        `📁 *${escapeMarkdown(projectName)}*\n\n📭 Задач не знайдено.`,
        { parse_mode: 'Markdown' },
      );
      return;
    }

    const totalPages = Math.ceil(total / PAGE_SIZE);
    const paginationKeyboard = buildPaginationKeyboard(0, totalPages, `filter_project:${projectId}`);
    const projectName = project?.name ?? projectId;

    await telegramClient.sendMessage(
      chatId,
      `📁 *${escapeMarkdown(projectName)}* — задачі (${total}):`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            ...buildTaskListKeyboard(tasks).inline_keyboard,
            ...paginationKeyboard.inline_keyboard,
          ],
        },
      },
    );
  } catch (err) {
    await sendDbError(chatId, err);
  }
}

/**
 * Shows tasks for a specific employee (used in the by_employee filter flow).
 * Req 10.3
 */
export async function handleEmployeeTasksFilter(
  ctx: HandlerContext,
  userId: string,
): Promise<void> {
  const { chatId } = ctx;

  try {
    const { tasks, total } = await taskService.getTasksWithFilters({ userId }, 0);

    // Get employee display name
    const employees = await userService.getAllEmployeesWithWeeklyTime();
    const employee = employees.find((e) => e.id === userId);
    const displayName = employee ? userService.getDisplayName(employee) : userId;

    if (tasks.length === 0) {
      await telegramClient.sendMessage(
        chatId,
        `👤 *${escapeMarkdown(displayName)}*\n\n📭 Задач не знайдено.`,
        { parse_mode: 'Markdown' },
      );
      return;
    }

    const totalPages = Math.ceil(total / PAGE_SIZE);
    const paginationKeyboard = buildPaginationKeyboard(0, totalPages, `filter_employee:${userId}`);

    await telegramClient.sendMessage(
      chatId,
      `👤 *${escapeMarkdown(displayName)}* — задачі (${total}):`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            ...buildTaskListKeyboard(tasks).inline_keyboard,
            ...paginationKeyboard.inline_keyboard,
          ],
        },
      },
    );
  } catch (err) {
    await sendDbError(chatId, err);
  }
}
