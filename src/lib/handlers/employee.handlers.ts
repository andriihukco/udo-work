/**
 * Employee handlers for the Telegram Time Tracker bot.
 * Requirements: 3.1–3.5, 4.1–4.4, 5.1–5.4, 6.1–6.6, 7.1–7.6, 8.1–8.5, 16.3, 16.4
 */

import * as telegramClient from '@/lib/telegram/client';
import { projectService } from '@/lib/services/project.service';
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
  ACTIVITY_PERIOD_KEYBOARD,
  DELIVERABLE_CHOICE_KEYBOARD,
  ADD_MORE_KEYBOARD,
  EMPLOYEE_MAIN_MENU,
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
      await reply(chatId, messageId, MESSAGES.ACTIVE_TASK_EXISTS, { reply_markup: EMPLOYEE_MAIN_MENU });
      return;
    }
    const projects = await projectService.getActiveProjects();
    if (projects.length === 0) {
      await reply(chatId, messageId, MESSAGES.NO_ACTIVE_PROJECTS, { reply_markup: EMPLOYEE_MAIN_MENU });
      return;
    }
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
      await reply(chatId, messageId, MESSAGES.NO_ACTIVE_PROJECTS, { reply_markup: EMPLOYEE_MAIN_MENU });
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
    await telegramClient.sendMessage(chatId, MESSAGES.SESSION_RESET, { reply_markup: EMPLOYEE_MAIN_MENU });
    return;
  }
  try {
    const { task, timeLog } = await taskService.startTask(user.id, sessionCtx.selectedProjectId, text);
    await sessionService.resetSession(user.id);
    await telegramClient.sendMessage(
      chatId,
      MESSAGES.TASK_STARTED(esc(task.name), esc(sessionCtx.selectedProjectName), timeLog.started_at),
      { parse_mode: 'Markdown', reply_markup: EMPLOYEE_MAIN_MENU },
    );
    const project = await projectService.findById(sessionCtx.selectedProjectId);
    if (project) {
      notificationService
        .notifyTaskStarted(user, task, project, new Date(timeLog.started_at))
        .catch((err) => logger.error('notifyTaskStarted failed', err));
    }
  } catch (err) {
    if (err instanceof ActiveTaskExistsError) {
      await telegramClient.sendMessage(chatId, MESSAGES.ACTIVE_TASK_EXISTS, { reply_markup: EMPLOYEE_MAIN_MENU });
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
      { parse_mode: 'Markdown', reply_markup: EMPLOYEE_MAIN_MENU },
    );
  } catch (err) {
    if (err instanceof NoActiveTaskError) {
      await reply(chatId, messageId, MESSAGES.NO_ACTIVE_TASK, { reply_markup: EMPLOYEE_MAIN_MENU });
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
      { parse_mode: 'Markdown', reply_markup: EMPLOYEE_MAIN_MENU },
    );
  } catch (err) {
    if (err instanceof NoPausedTaskError) {
      await reply(chatId, messageId, MESSAGES.NO_PAUSED_TASK, { reply_markup: EMPLOYEE_MAIN_MENU });
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
      await reply(chatId, messageId, MESSAGES.NO_ACTIVE_TASK, { reply_markup: EMPLOYEE_MAIN_MENU });
      return;
    }
    const sessionCtx: AwaitingDeliverableContext = { taskId: activeTask.id, taskName: activeTask.name, attachmentCount: 0 };
    await sessionService.setState(user.id, 'awaiting_deliverable_choice', sessionCtx as unknown as Record<string, unknown>);
    await reply(chatId, messageId,
      `✅ *${esc(activeTask.name)}*\n\n${MESSAGES.ATTACH_DELIVERABLE_PROMPT}`,
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
    await reply(chatId, messageId, '📎 Надішліть файл або текстовий опис результату:\n_/cancel — скасувати_', { parse_mode: 'Markdown' });
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
    await telegramClient.sendMessage(chatId, MESSAGES.SESSION_RESET, { reply_markup: EMPLOYEE_MAIN_MENU });
    return;
  }
  try {
    if (message.document) {
      const doc = message.document;
      const url = await storageService.uploadFile(doc.file_id, doc.file_name ?? 'file', doc.file_size ?? 0, user.id, deliverableCtx.taskId);
      await storageService.saveFileAttachment(deliverableCtx.taskId, url, doc.file_name ?? 'file');
    } else if (message.photo && message.photo.length > 0) {
      const photo = message.photo[message.photo.length - 1];
      const url = await storageService.uploadFile(photo.file_id, `photo_${photo.file_id}.jpg`, photo.file_size ?? 0, user.id, deliverableCtx.taskId);
      await storageService.saveFileAttachment(deliverableCtx.taskId, url, `photo_${photo.file_id}.jpg`);
    } else if (message.text) {
      await storageService.saveTextAttachment(deliverableCtx.taskId, message.text);
    } else {
      await telegramClient.sendMessage(chatId, '⚠️ Будь ласка, надішліть файл або текстове повідомлення.');
      return;
    }
    const updatedCtx: AwaitingDeliverableContext = { ...deliverableCtx, attachmentCount: deliverableCtx.attachmentCount + 1 };
    await sessionService.setState(user.id, 'awaiting_deliverable_choice', updatedCtx as unknown as Record<string, unknown>);
    await telegramClient.sendMessage(chatId, MESSAGES.DELIVERABLE_SAVED, { reply_markup: ADD_MORE_KEYBOARD });
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
    await reply(chatId, messageId, '📎 Надішліть наступний файл або текстовий опис:\n_/cancel — скасувати_', { parse_mode: 'Markdown' });
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
    await sessionService.resetSession(user.id);
    await telegramClient.sendMessage(
      chatId,
      MESSAGES.TASK_COMPLETED(esc(task.name), totalTime),
      { parse_mode: 'Markdown', reply_markup: EMPLOYEE_MAIN_MENU },
    );
    const deliverableCtx = session.context as AwaitingDeliverableContext | null;
    const project = await projectService.findById(task.project_id);
    if (project) {
      const attachments = deliverableCtx?.taskId ? await storageService.getAttachments(deliverableCtx.taskId) : [];
      notificationService
        .notifyTaskCompleted(user, task, project, totalTime, attachments)
        .catch((err) => logger.error('notifyTaskCompleted failed', err));
    }
  } catch (err) {
    if (err instanceof NoActiveTaskError) {
      await telegramClient.sendMessage(chatId, MESSAGES.NO_ACTIVE_TASK, { reply_markup: EMPLOYEE_MAIN_MENU });
    } else {
      await sendDbError(chatId, err);
    }
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
  for (const s of projectMap.values()) {
    lines.push(`📁 *${esc(s.projectName)}*\n   ⏱ ${formatTimeSpent(s.timeSpent)} (${s.taskCount} задач)\n`);
  }
  const totalMin = activities.reduce((s, a) => s + a.timeSpent.totalMinutes, 0);
  lines.push(`\n*Загалом:* ${formatTimeSpent({ hours: Math.floor(totalMin / 60), minutes: totalMin % 60, totalMinutes: totalMin })}`);
  return lines.join('\n');
}
