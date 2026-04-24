/**
 * Employee handlers for the Telegram Time Tracker bot.
 * Requirements: 3.1–3.5, 4.1–4.4, 5.1–5.4, 6.1–6.6, 7.1–7.6, 8.1–8.5, 16.3, 16.4
 */

import * as telegramClient from '@/lib/telegram/client';
import { projectService } from '@/lib/services/project.service';
import { membershipService } from '@/lib/services/membership.service';
import { taskService } from '@/lib/services/task.service';
import { sessionService } from '@/lib/services/session.service';
import { notificationService } from '@/lib/services/notification.service';
import { storageService } from '@/lib/services/storage.service';
import { MESSAGES } from '@/lib/messages';
import { logger } from '@/lib/utils/logger';
import { validateTaskName } from '@/lib/utils/validation';
import { formatTimeSpent, getStartOfDay, getStartOfWeek } from '@/lib/utils/time';
import {
  buildProjectKeyboard,
  buildRecentTasksKeyboard,
  ACTIVITY_PERIOD_KEYBOARD,
  DELIVERABLE_CHOICE_KEYBOARD,
  ADD_MORE_KEYBOARD,
  EMPLOYEE_MAIN_MENU,
  buildContextualEmployeeMenu,
} from '@/lib/telegram/keyboards';
import {
  ActiveTaskExistsError,
  NoActiveTaskError,
  NoPausedTaskError,
  FileTooLargeError,
  ValidationError,
  StorageError,
} from '@/types/index';
import type {
  HandlerContext,
  TelegramMessage,
  AwaitingTaskNameContext,
  AwaitingDeliverableContext,
  TaskActivity,
  ProjectSummary,
  TimeSpent,
} from '@/types/index';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function sendDbError(chatId: number, err: unknown): Promise<void> {
  logger.error('Employee handler: error', err);
  await telegramClient.sendMessage(chatId, MESSAGES.DB_ERROR);
}

/** Returns a context-aware employee menu based on the user's current task state. */
async function getEmployeeMenu(userId: string, telegramId: number) {
  try {
    const activeTask = await taskService.getActiveTask(userId);
    return buildContextualEmployeeMenu(
      activeTask ? (activeTask.status as 'in_progress' | 'paused') : null,
      telegramId,
    );
  } catch {
    return buildContextualEmployeeMenu(null, telegramId);
  }
}

function esc(text: string): string {
  return text.replace(/[_*`[\]]/g, (c) => '\\' + c);
}

function statusEmoji(status: string): string {
  return status === 'in_progress' ? '▶️' : status === 'paused' ? '⏸' : '✅';
}

/** Edit message if messageId present, otherwise send new. Falls back to send if edit fails. */
async function reply(
  chatId: number,
  messageId: number | undefined,
  text: string,
  options: Parameters<typeof telegramClient.sendMessage>[2] = {},
): Promise<void> {
  if (messageId) {
    await telegramClient.editMessageText(chatId, messageId, text, options).catch(async () => {
      await telegramClient.sendMessage(chatId, text, options);
    });
  } else {
    await telegramClient.sendMessage(chatId, text, options);
  }
}

// ---------------------------------------------------------------------------
// 3. Start task flow
// ---------------------------------------------------------------------------

export async function handleStartTask(ctx: HandlerContext): Promise<void> {
  const { user, chatId, messageId } = ctx;
  try {
    const activeTask = await taskService.getActiveTask(user.id);
    if (activeTask) {
      const menu = buildContextualEmployeeMenu(activeTask.status as 'in_progress' | 'paused', user.telegram_id);
      await reply(chatId, messageId, MESSAGES.ACTIVE_TASK_EXISTS, { reply_markup: menu });
      return;
    }
    // Show projects the employee is a member of; fall back to all active projects
    let projects = await membershipService.getProjectsForUser(user.id);
    if (projects.length === 0) {
      projects = await projectService.getActiveProjects();
    }
    if (projects.length === 0) {
      await reply(chatId, messageId, MESSAGES.NO_ACTIVE_PROJECTS, { reply_markup: buildContextualEmployeeMenu(null, user.telegram_id) });
      return;
    }
    // Set state BEFORE showing the keyboard so the router knows this is an
    // employee project-selection (not an admin deactivation flow).
    await sessionService.setState(user.id, 'awaiting_task_name', {});
    await reply(chatId, messageId, '📁 Оберіть проєкт:', {
      reply_markup: buildProjectKeyboard(projects, 'action:back_to_main'),
    });
  } catch (err) {
    await sendDbError(chatId, err);
  }
}

export async function handleProjectSelected(ctx: HandlerContext, projectId: string): Promise<void> {
  const { user, chatId, messageId } = ctx;
  try {
    const project = await projectService.findById(projectId);
    if (!project) {
      await reply(chatId, messageId, MESSAGES.NO_ACTIVE_PROJECTS, { reply_markup: buildContextualEmployeeMenu(null, user.telegram_id) });
      return;
    }
    const sessionContext: AwaitingTaskNameContext = {
      selectedProjectId: project.id,
      selectedProjectName: project.name,
    };
    await sessionService.setState(user.id, 'awaiting_task_name', sessionContext as unknown as Record<string, unknown>);
    // Send new message for text input prompt (can't edit to text-only without keyboard)
    await telegramClient.sendMessage(
      chatId,
      `📌 Проєкт: *${esc(project.name)}*\n\nВведіть назву задачі (до 200 символів):\n_/cancel — скасувати_`,
      { parse_mode: 'Markdown' },
    );
  } catch (err) {
    await sendDbError(chatId, err);
  }
}

export async function handleTaskNameInput(ctx: HandlerContext, text: string): Promise<void> {
  const { user, session, chatId } = ctx;
  if (!validateTaskName(text)) {
    await telegramClient.sendMessage(chatId, MESSAGES.TASK_NAME_TOO_LONG);
    return;
  }
  const sessionCtx = session.context as AwaitingTaskNameContext | null;
  if (!sessionCtx?.selectedProjectId || !sessionCtx?.selectedProjectName) {
    await sessionService.resetSession(user.id);
    await telegramClient.sendMessage(chatId, MESSAGES.SESSION_RESET, { reply_markup: buildContextualEmployeeMenu(null, user.telegram_id) });
    return;
  }
  try {
    const { task, timeLog } = await taskService.startTask(user.id, sessionCtx.selectedProjectId, text);
    await sessionService.resetSession(user.id);
    await telegramClient.sendMessage(
      chatId,
      MESSAGES.TASK_STARTED(esc(task.name), esc(sessionCtx.selectedProjectName), timeLog.started_at),
      { parse_mode: 'Markdown', reply_markup: buildContextualEmployeeMenu('in_progress', user.telegram_id) },
    );
    const project = await projectService.findById(sessionCtx.selectedProjectId);
    if (project) {
      await notificationService
        .notifyTaskStarted(user, task, project, new Date(timeLog.started_at))
        .catch((err) => logger.error('notifyTaskStarted failed', err));
    }
  } catch (err) {
    if (err instanceof ActiveTaskExistsError) {
      await telegramClient.sendMessage(chatId, MESSAGES.ACTIVE_TASK_EXISTS, { reply_markup: buildContextualEmployeeMenu('in_progress', user.telegram_id) });
    } else if (err instanceof ValidationError) {
      await telegramClient.sendMessage(chatId, MESSAGES.TASK_NAME_TOO_LONG);
    } else {
      await sendDbError(chatId, err);
    }
  }
}

// ---------------------------------------------------------------------------
// 4. Pause task
// ---------------------------------------------------------------------------

export async function handlePauseTask(ctx: HandlerContext): Promise<void> {
  const { user, chatId, messageId } = ctx;
  try {
    const { task, timeLog } = await taskService.pauseTask(user.id);
    await sessionService.resetSession(user.id);
    await reply(chatId, messageId,
      MESSAGES.TASK_PAUSED(esc(task.name), timeLog.paused_at ?? new Date().toISOString()),
      { parse_mode: 'Markdown', reply_markup: buildContextualEmployeeMenu('paused', user.telegram_id) },
    );
  } catch (err) {
    if (err instanceof NoActiveTaskError) {
      await reply(chatId, messageId, MESSAGES.NO_ACTIVE_TASK, { reply_markup: buildContextualEmployeeMenu(null, user.telegram_id) });
    } else {
      await sendDbError(chatId, err);
    }
  }
}

// ---------------------------------------------------------------------------
// 5. Resume task
// ---------------------------------------------------------------------------

export async function handleResumeTask(ctx: HandlerContext): Promise<void> {
  const { user, chatId, messageId } = ctx;
  try {
    const { task, timeLog } = await taskService.resumeTask(user.id);
    await sessionService.resetSession(user.id);
    await reply(chatId, messageId,
      MESSAGES.TASK_RESUMED(esc(task.name), timeLog.started_at),
      { parse_mode: 'Markdown', reply_markup: buildContextualEmployeeMenu('in_progress', user.telegram_id) },
    );
  } catch (err) {
    if (err instanceof NoPausedTaskError) {
      await reply(chatId, messageId, MESSAGES.NO_PAUSED_TASK, { reply_markup: buildContextualEmployeeMenu(null, user.telegram_id) });
    } else {
      await sendDbError(chatId, err);
    }
  }
}

// ---------------------------------------------------------------------------
// 6. Complete task flow
// ---------------------------------------------------------------------------

export async function handleCompleteTask(ctx: HandlerContext): Promise<void> {
  const { user, chatId, messageId } = ctx;
  try {
    const activeTask = await taskService.getActiveTask(user.id);
    if (!activeTask) {
      await reply(chatId, messageId, MESSAGES.NO_ACTIVE_TASK, { reply_markup: buildContextualEmployeeMenu(null, user.telegram_id) });
      return;
    }
    const sessionCtx: AwaitingDeliverableContext = { taskId: activeTask.id, taskName: activeTask.name, attachmentCount: 0 };
    await sessionService.setState(user.id, 'awaiting_task_comment', sessionCtx as unknown as Record<string, unknown>);
    await reply(chatId, messageId,
      `✅ *${esc(activeTask.name)}*\n\n💬 Додайте короткий коментар до задачі:\n_(що було зроблено, результат тощо)_\n\n_/skip — пропустити_`,
      { parse_mode: 'Markdown' },
    );
  } catch (err) {
    await sendDbError(chatId, err);
  }
}

export async function handleTaskCommentInput(ctx: HandlerContext, text: string): Promise<void> {
  const { user, session, chatId } = ctx;
  const deliverableCtx = session.context as AwaitingDeliverableContext | null;
  if (!deliverableCtx?.taskId) {
    await sessionService.resetSession(user.id);
    await telegramClient.sendMessage(chatId, MESSAGES.SESSION_RESET, { reply_markup: buildContextualEmployeeMenu(null, user.telegram_id) });
    return;
  }
  try {
    if (text !== '/skip' && text.trim()) {
      // Save comment as a text attachment tagged as comment
      await storageService.saveTextAttachment(deliverableCtx.taskId, `💬 ${text.trim()}`);
    }
    await sessionService.setState(user.id, 'awaiting_deliverable_choice', deliverableCtx as unknown as Record<string, unknown>);
    await telegramClient.sendMessage(chatId,
      `📎 *${esc(deliverableCtx.taskName)}*\n\n${MESSAGES.ATTACH_DELIVERABLE_PROMPT}`,
      { parse_mode: 'Markdown', reply_markup: DELIVERABLE_CHOICE_KEYBOARD },
    );
  } catch (err) {
    await sendDbError(chatId, err);
  }
}

export async function handleDeliverableChoice(ctx: HandlerContext, choice: string): Promise<void> {
  const { user, session, chatId, messageId } = ctx;
  if (choice === 'yes') {
    await sessionService.setState(user.id, 'awaiting_deliverable', session.context as Record<string, unknown>);
    await reply(chatId, messageId,
      `📎 *Надішліть файли або фото результату*\n\n` +
      `Можна надіслати:\n` +
      `• Одне або кілька фото / файлів\n` +
      `• Текстовий опис\n\n` +
      `_Надсилайте по одному або альбомом. Після кожного файлу буде запит "додати ще"._\n` +
      `_/cancel — скасувати_`,
      { parse_mode: 'Markdown' });
    return;
  }
  if (choice === 'skip') {
    await finaliseTask(ctx);
    return;
  }
}

export async function handleDeliverableInput(ctx: HandlerContext, message: TelegramMessage): Promise<void> {
  const { user, session, chatId } = ctx;
  const deliverableCtx = session.context as AwaitingDeliverableContext | null;
  if (!deliverableCtx?.taskId) {
    await sessionService.resetSession(user.id);
    await telegramClient.sendMessage(chatId, MESSAGES.SESSION_RESET, { reply_markup: buildContextualEmployeeMenu(null, user.telegram_id) });
    return;
  }
  try {
    let savedCount = 0;

    if (message.document) {
      const doc = message.document;
      const url = await storageService.uploadFile(doc.file_id, doc.file_name ?? 'file', doc.file_size ?? 0, user.id, deliverableCtx.taskId);
      await storageService.saveFileAttachment(deliverableCtx.taskId, url, doc.file_name ?? 'file');
      savedCount = 1;
    } else if (message.photo && message.photo.length > 0) {
      // Pick the highest-resolution photo variant
      const photo = message.photo[message.photo.length - 1];
      const fileName = `photo_${Date.now()}.jpg`;
      const url = await storageService.uploadFile(photo.file_id, fileName, photo.file_size ?? 0, user.id, deliverableCtx.taskId);
      await storageService.saveFileAttachment(deliverableCtx.taskId, url, fileName);
      savedCount = 1;
    } else if (message.text) {
      await storageService.saveTextAttachment(deliverableCtx.taskId, message.text);
      savedCount = 1;
    } else {
      await telegramClient.sendMessage(chatId, '⚠️ Будь ласка, надішліть файл, фото або текстове повідомлення.');
      return;
    }

    const newCount = deliverableCtx.attachmentCount + savedCount;
    const updatedCtx: AwaitingDeliverableContext = { ...deliverableCtx, attachmentCount: newCount };
    await sessionService.setState(user.id, 'awaiting_deliverable_choice', updatedCtx as unknown as Record<string, unknown>);

    const countLabel = newCount === 1 ? '1 файл' : `${newCount} файли`;
    await telegramClient.sendMessage(chatId,
      `✅ *Збережено* (${countLabel} загалом)\n\nДодати ще?`,
      { parse_mode: 'Markdown', reply_markup: ADD_MORE_KEYBOARD });
  } catch (err) {
    if (err instanceof FileTooLargeError) {
      await telegramClient.sendMessage(chatId, MESSAGES.FILE_TOO_LARGE);
    } else if (err instanceof StorageError) {
      await telegramClient.sendMessage(chatId, MESSAGES.STORAGE_ERROR);
    } else {
      await sendDbError(chatId, err);
    }
  }
}

export async function handleAddMoreOrFinish(ctx: HandlerContext, choice: string): Promise<void> {
  const { user, session, chatId, messageId } = ctx;
  if (choice === 'add_more') {
    await sessionService.setState(user.id, 'awaiting_deliverable', session.context as Record<string, unknown>);
    const deliverableCtx = session.context as AwaitingDeliverableContext | null;
    const count = deliverableCtx?.attachmentCount ?? 0;
    await reply(chatId, messageId,
      `📎 Надішліть ще файл або фото:\n_Вже збережено: ${count}_\n_/cancel — скасувати_`,
      { parse_mode: 'Markdown' });
    return;
  }
  if (choice === 'finish') {
    await finaliseTask(ctx);
  }
}

async function finaliseTask(ctx: HandlerContext): Promise<void> {
  const { user, session, chatId } = ctx;
  try {
    const { task, totalTime } = await taskService.completeTask(user.id);
    const attachments = await storageService.getAttachments(task.id);
    await sessionService.resetSession(user.id);
    await telegramClient.sendMessage(
      chatId,
      MESSAGES.TASK_COMPLETED(esc(task.name), totalTime),
      { parse_mode: 'Markdown', reply_markup: buildContextualEmployeeMenu(null, user.telegram_id) },
    );
    const project = await projectService.findById(task.project_id);
    if (project) {
      await notificationService
        .notifyTaskCompleted(user, task, project, totalTime, attachments)
        .catch((err) => logger.error('notifyTaskCompleted failed', err));
    }
  } catch (err) {
    if (err instanceof NoActiveTaskError) {
      await telegramClient.sendMessage(chatId, MESSAGES.NO_ACTIVE_TASK, { reply_markup: buildContextualEmployeeMenu(null, user.telegram_id) });
    } else {
      await sendDbError(chatId, err);
    }
  }
}

// ---------------------------------------------------------------------------
// Recent tasks (reuse)
// ---------------------------------------------------------------------------

export async function handleRecentTasks(ctx: HandlerContext, page = 0): Promise<void> {
  const { user, chatId, messageId } = ctx;
  try {
    const activeTask = await taskService.getActiveTask(user.id);
    if (activeTask) {
      await reply(chatId, messageId, MESSAGES.ACTIVE_TASK_EXISTS, { reply_markup: buildContextualEmployeeMenu(activeTask.status as 'in_progress' | 'paused', user.telegram_id) });
      return;
    }
    const { tasks, total } = await taskService.getTasksWithFilters({ userId: user.id }, page);
    if (tasks.length === 0 && page === 0) {
      await reply(chatId, messageId, '📭 У вас ще немає завершених задач для повторного використання.', { reply_markup: buildContextualEmployeeMenu(null, user.telegram_id) });
      return;
    }
    const totalPages = Math.ceil(total / 10);
    const keyboard = buildRecentTasksKeyboard(tasks, page, totalPages);
    await reply(chatId, messageId,
      `🔄 *Оберіть задачу для повторення* (стор. ${page + 1}/${Math.max(1, totalPages)}):\n_Або введіть нову назву_`,
      { parse_mode: 'Markdown', reply_markup: keyboard },
    );
  } catch (err) {
    await sendDbError(chatId, err);
  }
}

export async function handleReuseTask(ctx: HandlerContext, taskId: string): Promise<void> {
  const { user, chatId, messageId } = ctx;
  try {
    const tasks = await taskService.getTimeLogs(taskId); // just to get task info
    // Fetch the task directly
    const { tasks: found } = await taskService.getTasksWithFilters({ userId: user.id }, 0);
    const original = found.find(t => t.id === taskId);
    if (!original) {
      await reply(chatId, messageId, '⚠️ Задачу не знайдено.', { reply_markup: buildContextualEmployeeMenu(null, user.telegram_id) });
      return;
    }
    // Store project + suggested name in session, ask to confirm or rename
    const sessionContext: AwaitingTaskNameContext = {
      selectedProjectId: original.project_id,
      selectedProjectName: '', // will be filled below
    };
    const project = await projectService.findById(original.project_id);
    if (!project) {
      await reply(chatId, messageId, MESSAGES.NO_ACTIVE_PROJECTS, { reply_markup: buildContextualEmployeeMenu(null, user.telegram_id) });
      return;
    }
    sessionContext.selectedProjectName = project.name;
    await sessionService.setState(user.id, 'awaiting_task_name', sessionContext as unknown as Record<string, unknown>);
    await telegramClient.sendMessage(chatId,
      `📌 Проєкт: *${esc(project.name)}*\n\n` +
      `Попередня назва: _${esc(original.name)}_\n\n` +
      `Введіть нову назву або надішліть ту саму:\n_/cancel — скасувати_`,
      { parse_mode: 'Markdown' },
    );
  } catch (err) {
    await sendDbError(chatId, err);
  }
}

// ---------------------------------------------------------------------------
// 8. My Activity
// ---------------------------------------------------------------------------

export async function handleMyActivity(ctx: HandlerContext): Promise<void> {
  const { chatId, messageId } = ctx;
  await reply(chatId, messageId, '📊 Оберіть період:', { reply_markup: ACTIVITY_PERIOD_KEYBOARD });
}

export async function handleActivityPeriod(ctx: HandlerContext, period: string): Promise<void> {
  const { user, chatId, messageId } = ctx;
  try {
    const from = period === 'today' ? getStartOfDay('Europe/Kiev') : getStartOfWeek('Europe/Kiev');
    const activities = await taskService.getTasksForUser(user.id, from, new Date());
    const back = { inline_keyboard: [[{ text: '◀️ Назад', callback_data: 'action:my_activity' }]] };

    if (activities.length === 0) {
      await reply(chatId, messageId, MESSAGES.NO_ACTIVITY, { reply_markup: back });
      return;
    }
    const text = period === 'today' ? formatTodayReport(activities) : formatWeeklyReport(activities);
    await reply(chatId, messageId, text, { parse_mode: 'Markdown', reply_markup: back });
  } catch (err) {
    await sendDbError(chatId, err);
  }
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

function formatTodayReport(activities: TaskActivity[]): string {
  const lines = ['📅 *Активність за сьогодні:*\n'];
  for (const a of activities) {
    lines.push(`${statusEmoji(a.status)} *${esc(a.taskName)}*\n   📁 ${esc(a.projectName)}\n   ⏱ ${formatTimeSpent(a.timeSpent)}\n`);
  }
  const totalMin = activities.reduce((s, a) => s + a.timeSpent.totalMinutes, 0);
  lines.push(`\n*Загалом:* ${formatTimeSpent({ hours: Math.floor(totalMin / 60), minutes: totalMin % 60, totalMinutes: totalMin })}`);
  return lines.join('\n');
}

function formatWeeklyReport(activities: TaskActivity[]): string {
  const projectMap = new Map<string, ProjectSummary>();
  for (const a of activities) {
    const existing = projectMap.get(a.projectName);
    if (existing) {
      const t = existing.timeSpent.totalMinutes + a.timeSpent.totalMinutes;
      projectMap.set(a.projectName, { projectName: a.projectName, timeSpent: { hours: Math.floor(t / 60), minutes: t % 60, totalMinutes: t }, taskCount: existing.taskCount + 1 });
    } else {
      projectMap.set(a.projectName, { projectName: a.projectName, timeSpent: { ...a.timeSpent }, taskCount: 1 });
    }
  }
  const lines = ['📆 *Активність за цей тиждень:*\n'];
  for (const s of Array.from(projectMap.values())) {
    lines.push(`📁 *${esc(s.projectName)}*\n   ⏱ ${formatTimeSpent(s.timeSpent)} (${s.taskCount} задач)\n`);
  }
  const totalMin = activities.reduce((s, a) => s + a.timeSpent.totalMinutes, 0);
  lines.push(`\n*Загалом:* ${formatTimeSpent({ hours: Math.floor(totalMin / 60), minutes: totalMin % 60, totalMinutes: totalMin })}`);
  return lines.join('\n');
}
