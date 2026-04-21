/**
 * Employee handlers for the Telegram Time Tracker bot.
 *
 * Implements all employee-facing conversation flows:
 *  - Start task (project selection → task name input)
 *  - Pause / Resume task
 *  - Complete task (with optional deliverable attachment flow)
 *  - My Activity (today / this week)
 *
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
  DatabaseError,
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
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Sends a generic database error message to the user and logs the error.
 */
async function sendDbError(chatId: number, err: unknown): Promise<void> {
  logger.error('Employee handler: database error', err);
  await telegramClient.sendMessage(chatId, MESSAGES.DB_ERROR);
}

/**
 * Sends a generic storage error message to the user and logs the error.
 */
async function sendStorageError(chatId: number, err: unknown): Promise<void> {
  logger.error('Employee handler: storage error', err);
  await telegramClient.sendMessage(chatId, MESSAGES.STORAGE_ERROR);
}

// ---------------------------------------------------------------------------
// 3. Start task flow
// ---------------------------------------------------------------------------

/**
 * Entry point for the "start task" flow.
 * Checks that no active task exists, then shows the project selection keyboard.
 * Req 3.1, 3.4, 16.3
 */
export async function handleStartTask(ctx: HandlerContext): Promise<void> {
  const { user, chatId, messageId } = ctx;

  try {
    // Check for existing active task (Req 3.4)
    const activeTask = await taskService.getActiveTask(user.id);
    if (activeTask) {
      const text = MESSAGES.ACTIVE_TASK_EXISTS;
      if (messageId) {
        await telegramClient.editMessageText(chatId, messageId, text, { reply_markup: EMPLOYEE_MAIN_MENU });
      } else {
        await telegramClient.sendMessage(chatId, text, { reply_markup: EMPLOYEE_MAIN_MENU });
      }
      return;
    }

    // Fetch active projects (Req 3.1, 16.3)
    const projects = await projectService.getActiveProjects();
    if (projects.length === 0) {
      const text = MESSAGES.NO_ACTIVE_PROJECTS;
      if (messageId) {
        await telegramClient.editMessageText(chatId, messageId, text, { reply_markup: EMPLOYEE_MAIN_MENU });
      } else {
        await telegramClient.sendMessage(chatId, text, { reply_markup: EMPLOYEE_MAIN_MENU });
      }
      return;
    }

    const text = '📁 Оберіть проєкт:';
    const keyboard = buildProjectKeyboard(projects, 'action:back_to_main');
    if (messageId) {
      await telegramClient.editMessageText(chatId, messageId, text, { reply_markup: keyboard });
    } else {
      await telegramClient.sendMessage(chatId, text, { reply_markup: keyboard });
    }
  } catch (err) {
    await sendDbError(chatId, err);
  }
}

/**
 * Called when the employee selects a project from the keyboard.
 * Validates the project exists, stores it in session, and prompts for task name.
 * Req 3.2
 */
export async function handleProjectSelected(
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

    const sessionContext: AwaitingTaskNameContext = {
      selectedProjectId: project.id,
      selectedProjectName: project.name,
    };

    await sessionService.setState(user.id, 'awaiting_task_name', sessionContext as unknown as Record<string, unknown>);

    await telegramClient.sendMessage(
      chatId,
      `📌 Проєкт: *${project.name}*\n\nВведіть назву задачі (до 200 символів):`,
      { parse_mode: 'Markdown' },
    );
  } catch (err) {
    await sendDbError(chatId, err);
  }
}

/**
 * Called when the employee types a task name while in `awaiting_task_name` state.
 * Validates length, creates the task, sends confirmation, notifies admins.
 * Req 3.3, 3.5, 16.4
 */
export async function handleTaskNameInput(
  ctx: HandlerContext,
  text: string,
): Promise<void> {
  const { user, session, chatId } = ctx;

  // Validate task name length (Req 3.3, 16.4)
  if (!validateTaskName(text)) {
    await telegramClient.sendMessage(chatId, MESSAGES.TASK_NAME_TOO_LONG);
    return;
  }

  const sessionCtx = session.context as AwaitingTaskNameContext | null;
  if (!sessionCtx?.selectedProjectId || !sessionCtx?.selectedProjectName) {
    // Session context lost — reset and ask to start again
    await sessionService.resetSession(user.id);
    await telegramClient.sendMessage(chatId, MESSAGES.SESSION_RESET, {
      reply_markup: EMPLOYEE_MAIN_MENU,
    });
    return;
  }

  try {
    const { task, timeLog } = await taskService.startTask(
      user.id,
      sessionCtx.selectedProjectId,
      text,
    );

    // Reset session to idle (Req 3.5)
    await sessionService.resetSession(user.id);

    // Send confirmation (Req 3.5)
    await telegramClient.sendMessage(
      chatId,
      MESSAGES.TASK_STARTED(task.name, sessionCtx.selectedProjectName, timeLog.started_at),
      { parse_mode: 'Markdown' },
    );

    // Notify admins (Req 11.1)
    const project = await projectService.findById(sessionCtx.selectedProjectId);
    if (project) {
      notificationService
        .notifyTaskStarted(user, task, project, new Date(timeLog.started_at))
        .catch((err) => logger.error('handleTaskNameInput: notifyTaskStarted failed', err));
    }
  } catch (err) {
    if (err instanceof ActiveTaskExistsError) {
      await telegramClient.sendMessage(chatId, MESSAGES.ACTIVE_TASK_EXISTS);
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

/**
 * Pauses the employee's active task.
 * Req 4.1–4.4
 */
export async function handlePauseTask(ctx: HandlerContext): Promise<void> {
  const { user, chatId, messageId } = ctx;

  try {
    const { task, timeLog } = await taskService.pauseTask(user.id);

    await sessionService.resetSession(user.id);

    const text = MESSAGES.TASK_PAUSED(task.name, timeLog.paused_at ?? new Date().toISOString());
    if (messageId) {
      await telegramClient.editMessageText(chatId, messageId, text, {
        parse_mode: 'Markdown',
        reply_markup: EMPLOYEE_MAIN_MENU,
      });
    } else {
      await telegramClient.sendMessage(chatId, text, {
        parse_mode: 'Markdown',
        reply_markup: EMPLOYEE_MAIN_MENU,
      });
    }
  } catch (err) {
    if (err instanceof NoActiveTaskError) {
      const text = MESSAGES.NO_ACTIVE_TASK;
      if (ctx.messageId) {
        await telegramClient.editMessageText(chatId, ctx.messageId, text, { reply_markup: EMPLOYEE_MAIN_MENU });
      } else {
        await telegramClient.sendMessage(chatId, text, { reply_markup: EMPLOYEE_MAIN_MENU });
      }
    } else {
      await sendDbError(chatId, err);
    }
  }
}

// ---------------------------------------------------------------------------
// 5. Resume task
// ---------------------------------------------------------------------------

/**
 * Resumes the employee's paused task.
 * Req 5.1–5.4
 */
export async function handleResumeTask(ctx: HandlerContext): Promise<void> {
  const { user, chatId, messageId } = ctx;

  try {
    const { task, timeLog } = await taskService.resumeTask(user.id);

    await sessionService.resetSession(user.id);

    const text = MESSAGES.TASK_RESUMED(task.name, timeLog.started_at);
    if (messageId) {
      await telegramClient.editMessageText(chatId, messageId, text, {
        parse_mode: 'Markdown',
        reply_markup: EMPLOYEE_MAIN_MENU,
      });
    } else {
      await telegramClient.sendMessage(chatId, text, {
        parse_mode: 'Markdown',
        reply_markup: EMPLOYEE_MAIN_MENU,
      });
    }
  } catch (err) {
    if (err instanceof NoPausedTaskError) {
      const text = MESSAGES.NO_PAUSED_TASK;
      if (ctx.messageId) {
        await telegramClient.editMessageText(chatId, ctx.messageId, text, { reply_markup: EMPLOYEE_MAIN_MENU });
      } else {
        await telegramClient.sendMessage(chatId, text, { reply_markup: EMPLOYEE_MAIN_MENU });
      }
    } else {
      await sendDbError(chatId, err);
    }
  }
}

// ---------------------------------------------------------------------------
// 6. Complete task flow
// ---------------------------------------------------------------------------

/**
 * Entry point for the "complete task" flow.
 * Checks that an active/paused task exists, then asks about deliverables.
 * Req 6.1–6.3
 */
export async function handleCompleteTask(ctx: HandlerContext): Promise<void> {
  const { user, chatId, messageId } = ctx;

  try {
    const activeTask = await taskService.getActiveTask(user.id);
    if (!activeTask) {
      const text = MESSAGES.NO_ACTIVE_TASK;
      if (messageId) {
        await telegramClient.editMessageText(chatId, messageId, text, { reply_markup: EMPLOYEE_MAIN_MENU });
      } else {
        await telegramClient.sendMessage(chatId, text, { reply_markup: EMPLOYEE_MAIN_MENU });
      }
      return;
    }

    // Store task info in session for the deliverable flow
    const sessionCtx: AwaitingDeliverableContext = {
      taskId: activeTask.id,
      taskName: activeTask.name,
      attachmentCount: 0,
    };

    await sessionService.setState(user.id, 'awaiting_deliverable_choice', sessionCtx as unknown as Record<string, unknown>);

    const text = `✅ *${escapeMarkdown(activeTask.name)}*\n\n${MESSAGES.ATTACH_DELIVERABLE_PROMPT}`;
    if (messageId) {
      await telegramClient.editMessageText(chatId, messageId, text, {
        parse_mode: 'Markdown',
        reply_markup: DELIVERABLE_CHOICE_KEYBOARD,
      });
    } else {
      await telegramClient.sendMessage(chatId, text, {
        parse_mode: 'Markdown',
        reply_markup: DELIVERABLE_CHOICE_KEYBOARD,
      });
    }
  } catch (err) {
    await sendDbError(chatId, err);
  }
}

/**
 * Handles the employee's choice on whether to attach a deliverable.
 * - 'yes': transitions to `awaiting_deliverable` state
 * - 'skip': completes the task immediately
 * Req 6.3–6.6
 */
export async function handleDeliverableChoice(
  ctx: HandlerContext,
  choice: string,
): Promise<void> {
  const { user, session, chatId } = ctx;

  if (choice === 'yes') {
    // Transition to awaiting_deliverable — keep existing context
    await sessionService.setState(user.id, 'awaiting_deliverable', session.context as Record<string, unknown>);
    await telegramClient.sendMessage(
      chatId,
      '📎 Надішліть файл або текстовий опис результату:',
    );
    return;
  }

  if (choice === 'skip') {
    await finaliseTask(ctx);
    return;
  }

  // Unknown choice — ignore
  logger.warn('handleDeliverableChoice: unknown choice', choice);
}

/**
 * Handles a deliverable message (file or text) from the employee.
 * Saves the attachment and asks whether to add more.
 * Req 7.1–7.4
 */
export async function handleDeliverableInput(
  ctx: HandlerContext,
  message: TelegramMessage,
): Promise<void> {
  const { user, session, chatId } = ctx;

  const deliverableCtx = session.context as AwaitingDeliverableContext | null;
  if (!deliverableCtx?.taskId) {
    await sessionService.resetSession(user.id);
    await telegramClient.sendMessage(chatId, MESSAGES.SESSION_RESET, {
      reply_markup: EMPLOYEE_MAIN_MENU,
    });
    return;
  }

  try {
    if (message.document) {
      // File attachment (Req 7.2)
      const doc = message.document;
      const fileName = doc.file_name ?? 'file';
      const fileSize = doc.file_size ?? 0;

      const url = await storageService.uploadFile(
        doc.file_id,
        fileName,
        fileSize,
        user.id,
        deliverableCtx.taskId,
      );

      await storageService.saveFileAttachment(deliverableCtx.taskId, url, fileName);
    } else if (message.photo && message.photo.length > 0) {
      // Photo attachment — use the largest photo size (Req 7.2)
      const photo = message.photo[message.photo.length - 1];
      const fileName = `photo_${photo.file_id}.jpg`;
      const fileSize = photo.file_size ?? 0;

      const url = await storageService.uploadFile(
        photo.file_id,
        fileName,
        fileSize,
        user.id,
        deliverableCtx.taskId,
      );

      await storageService.saveFileAttachment(deliverableCtx.taskId, url, fileName);
    } else if (message.text) {
      // Text attachment (Req 7.3)
      await storageService.saveTextAttachment(deliverableCtx.taskId, message.text);
    } else {
      // Unsupported message type
      await telegramClient.sendMessage(
        chatId,
        '⚠️ Будь ласка, надішліть файл або текстове повідомлення.',
      );
      return;
    }

    // Update attachment count in session context
    const updatedCtx: AwaitingDeliverableContext = {
      ...deliverableCtx,
      attachmentCount: deliverableCtx.attachmentCount + 1,
    };

    await sessionService.setState(user.id, 'awaiting_deliverable_choice', updatedCtx as unknown as Record<string, unknown>);

    // Ask whether to add more (Req 7.4)
    await telegramClient.sendMessage(chatId, MESSAGES.DELIVERABLE_SAVED, {
      reply_markup: ADD_MORE_KEYBOARD,
    });
  } catch (err) {
    if (err instanceof FileTooLargeError) {
      await telegramClient.sendMessage(chatId, MESSAGES.FILE_TOO_LARGE);
    } else if (err instanceof StorageError || err instanceof DatabaseError) {
      await sendStorageError(chatId, err);
    } else {
      await sendStorageError(chatId, err);
    }
  }
}

/**
 * Handles the "add more / finish" choice after a deliverable is saved.
 * - 'add_more': transitions back to `awaiting_deliverable`
 * - 'finish': finalises the task
 * Req 7.4, 7.5
 */
export async function handleAddMoreOrFinish(
  ctx: HandlerContext,
  choice: string,
): Promise<void> {
  const { user, session, chatId } = ctx;

  if (choice === 'add_more') {
    await sessionService.setState(user.id, 'awaiting_deliverable', session.context as Record<string, unknown>);
    await telegramClient.sendMessage(
      chatId,
      '📎 Надішліть наступний файл або текстовий опис результату:',
    );
    return;
  }

  if (choice === 'finish') {
    await finaliseTask(ctx);
    return;
  }

  logger.warn('handleAddMoreOrFinish: unknown choice', choice);
}

/**
 * Finalises the task: completes it in the DB, sends confirmation, notifies admins.
 * Used by both handleDeliverableChoice('skip') and handleAddMoreOrFinish('finish').
 * Req 6.4, 6.6, 11.2
 */
async function finaliseTask(ctx: HandlerContext): Promise<void> {
  const { user, session, chatId } = ctx;

  try {
    const { task, totalTime } = await taskService.completeTask(user.id);

    await sessionService.resetSession(user.id);

    // Send completion confirmation (Req 6.4, 6.6)
    await telegramClient.sendMessage(
      chatId,
      MESSAGES.TASK_COMPLETED(task.name, totalTime),
      { parse_mode: 'Markdown', reply_markup: EMPLOYEE_MAIN_MENU },
    );

    // Fetch attachments and project for admin notification (Req 11.2)
    const deliverableCtx = session.context as AwaitingDeliverableContext | null;
    const project = await projectService.findById(task.project_id);

    if (project) {
      const attachments = deliverableCtx?.taskId
        ? await storageService.getAttachments(deliverableCtx.taskId)
        : [];

      notificationService
        .notifyTaskCompleted(user, task, project, totalTime, attachments)
        .catch((err) => logger.error('finaliseTask: notifyTaskCompleted failed', err));
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

/**
 * Shows the activity period selection keyboard.
 * Req 8.1
 */
export async function handleMyActivity(ctx: HandlerContext): Promise<void> {
  const { chatId, messageId } = ctx;

  const text = '📊 Оберіть період:';
  if (messageId) {
    await telegramClient.editMessageText(chatId, messageId, text, { reply_markup: ACTIVITY_PERIOD_KEYBOARD });
  } else {
    await telegramClient.sendMessage(chatId, text, { reply_markup: ACTIVITY_PERIOD_KEYBOARD });
  }
}

/**
 * Queries and formats the activity report for the selected period.
 * - 'today': tasks started today (UTC+2)
 * - 'week': tasks started this week (UTC+2), grouped by project
 * Req 8.2–8.5
 */
export async function handleActivityPeriod(
  ctx: HandlerContext,
  period: string,
): Promise<void> {
  const { user, chatId, messageId } = ctx;

  try {
    let from: Date;
    const to = new Date();

    if (period === 'today') {
      from = getStartOfDay('Europe/Kiev');
    } else if (period === 'week') {
      from = getStartOfWeek('Europe/Kiev');
    } else {
      logger.warn('handleActivityPeriod: unknown period', period);
      return;
    }

    const activities = await taskService.getTasksForUser(user.id, from, to);

    const backKeyboard = { inline_keyboard: [[{ text: '◀️ Назад', callback_data: 'action:my_activity' }]] };

    if (activities.length === 0) {
      if (messageId) {
        await telegramClient.editMessageText(chatId, messageId, MESSAGES.NO_ACTIVITY, { reply_markup: backKeyboard });
      } else {
        await telegramClient.sendMessage(chatId, MESSAGES.NO_ACTIVITY, { reply_markup: backKeyboard });
      }
      return;
    }

    const reportText = period === 'today' ? formatTodayReport(activities) : formatWeeklyReport(activities);

    if (messageId) {
      await telegramClient.editMessageText(chatId, messageId, reportText, {
        parse_mode: 'Markdown',
        reply_markup: backKeyboard,
      });
    } else {
      await telegramClient.sendMessage(chatId, reportText, {
        parse_mode: 'Markdown',
        reply_markup: backKeyboard,
      });
    }
  } catch (err) {
    await sendDbError(chatId, err);
  }
}

// ---------------------------------------------------------------------------
// Report formatters
// ---------------------------------------------------------------------------

/**
 * Formats a "today" activity report.
 * Shows task name, project, status, and time spent per task.
 * Req 8.2, 8.5
 */
function formatTodayReport(activities: TaskActivity[]): string {
  const lines: string[] = ['📅 *Активність за сьогодні:*\n'];

  for (const activity of activities) {
    const statusEmoji = getStatusEmoji(activity.status);
    lines.push(
      `${statusEmoji} *${escapeMarkdown(activity.taskName)}*\n` +
      `   📁 ${escapeMarkdown(activity.projectName)}\n` +
      `   ⏱ ${formatTimeSpent(activity.timeSpent)}\n`,
    );
  }

  const totalMinutes = activities.reduce((sum, a) => sum + a.timeSpent.totalMinutes, 0);
  const totalTime: TimeSpent = {
    hours: Math.floor(totalMinutes / 60),
    minutes: totalMinutes % 60,
    totalMinutes,
  };

  lines.push(`\n*Загалом:* ${formatTimeSpent(totalTime)}`);

  return lines.join('\n');
}

/**
 * Formats a "this week" activity report.
 * Groups tasks by project and shows total time per project.
 * Req 8.3, 8.5
 */
function formatWeeklyReport(activities: TaskActivity[]): string {
  // Group by project
  const projectMap = new Map<string, ProjectSummary>();

  for (const activity of activities) {
    const existing = projectMap.get(activity.projectName);
    if (existing) {
      const newTotalMinutes = existing.timeSpent.totalMinutes + activity.timeSpent.totalMinutes;
      projectMap.set(activity.projectName, {
        projectName: activity.projectName,
        timeSpent: {
          hours: Math.floor(newTotalMinutes / 60),
          minutes: newTotalMinutes % 60,
          totalMinutes: newTotalMinutes,
        },
        taskCount: existing.taskCount + 1,
      });
    } else {
      projectMap.set(activity.projectName, {
        projectName: activity.projectName,
        timeSpent: { ...activity.timeSpent },
        taskCount: 1,
      });
    }
  }

  const lines: string[] = ['📆 *Активність за цей тиждень:*\n'];

  for (const summary of Array.from(projectMap.values())) {
    lines.push(
      `📁 *${escapeMarkdown(summary.projectName)}*\n` +
      `   ⏱ ${formatTimeSpent(summary.timeSpent)} (${summary.taskCount} задач${getTaskSuffix(summary.taskCount)})\n`,
    );
  }

  const totalMinutes = activities.reduce((sum, a) => sum + a.timeSpent.totalMinutes, 0);
  const totalTime: TimeSpent = {
    hours: Math.floor(totalMinutes / 60),
    minutes: totalMinutes % 60,
    totalMinutes,
  };

  lines.push(`\n*Загалом:* ${formatTimeSpent(totalTime)}`);

  return lines.join('\n');
}

/**
 * Returns a Ukrainian task count suffix for grammatical agreement.
 */
function getTaskSuffix(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;

  if (mod100 >= 11 && mod100 <= 14) return 'и';
  if (mod10 === 1) return 'а';
  if (mod10 >= 2 && mod10 <= 4) return 'и';
  return 'и';
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
 * Escapes special Markdown characters in user-provided strings to prevent
 * formatting issues in Telegram messages.
 * Only escapes characters that break Markdown v1 formatting.
 */
function escapeMarkdown(text: string): string {
  // Escape backticks and underscores that could break Markdown formatting
  return text.replace(/[_*`[\]]/g, '\\$&');
}
