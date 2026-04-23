/**
 * Employee Timer API — used by the Pomodoro mini app.
 *
 * GET  ?telegramId=xxx  → returns current user info + active task + time logs
 * POST { telegramId, action, projectId?, taskName? } → start/pause/resume/complete
 *
 * Auth: telegramId must belong to a registered employee.
 */

import { supabase } from '@/lib/db/client';
import { taskService } from '@/lib/services/task.service';
import { projectService } from '@/lib/services/project.service';
import { membershipService } from '@/lib/services/membership.service';
import { notificationService } from '@/lib/services/notification.service';
import { storageService } from '@/lib/services/storage.service';
import { logger } from '@/lib/utils/logger';
import {
  ActiveTaskExistsError,
  NoActiveTaskError,
  NoPausedTaskError,
} from '@/types/index';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function resolveUser(telegramId: number) {
  const { data, error } = await supabase
    .from('users')
    .select('id, telegram_id, role, first_name, username, hourly_rate, created_at')
    .eq('telegram_id', telegramId)
    .maybeSingle();

  if (error) throw new Error('DB error');
  if (!data) return null;
  return data;
}

// ---------------------------------------------------------------------------
// GET — fetch current state
// ---------------------------------------------------------------------------

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const telegramId = Number(url.searchParams.get('telegramId'));

  if (!telegramId || isNaN(telegramId)) {
    return Response.json({ error: 'telegramId required' }, { status: 400 });
  }

  try {
    const user = await resolveUser(telegramId);
    if (!user) {
      return Response.json({ error: 'User not found' }, { status: 403 });
    }

    // Return role info for routing
    if (user.role === 'admin') {
      return Response.json({
        user: {
          id: user.id,
          name: user.first_name ?? (user.username ? `@${user.username}` : `ID ${user.telegram_id}`),
          role: 'admin',
        },
        activeTask: null,
        timeLogs: [],
        projects: [],
        todayTasks: [],
      });
    }

    // Employee flow
    const activeTask = await taskService.getActiveTask(user.id);

    // Time logs for active task
    let timeLogs: Awaited<ReturnType<typeof taskService.getTimeLogs>> = [];
    if (activeTask) {
      timeLogs = await taskService.getTimeLogs(activeTask.id);
    }

    // Projects the employee can use
    let projects = await membershipService.getProjectsForUser(user.id);
    if (projects.length === 0) {
      projects = await projectService.getActiveProjects();
    }

    // Today's completed tasks (for session history)
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayTasks = await taskService.getTasksForUser(user.id, todayStart, new Date());

    return Response.json({
      user: {
        id: user.id,
        name: user.first_name ?? (user.username ? `@${user.username}` : `ID ${user.telegram_id}`),
        hourlyRate: user.hourly_rate,
        role: 'employee',
      },
      activeTask: activeTask
        ? {
            id: activeTask.id,
            name: activeTask.name,
            projectId: activeTask.project_id,
            status: activeTask.status,
            createdAt: activeTask.created_at,
          }
        : null,
      timeLogs,
      projects: projects.map((p) => ({ id: p.id, name: p.name })),
      todayTasks,
    });
  } catch (err) {
    logger.error('Timer GET error', err);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST — perform action
// ---------------------------------------------------------------------------

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json();
    const { telegramId, action, projectId, taskName } = body;

    if (!telegramId || !action) {
      return Response.json({ error: 'telegramId and action required' }, { status: 400 });
    }

    const user = await resolveUser(Number(telegramId));
    if (!user) {
      return Response.json({ error: 'User not found' }, { status: 403 });
    }
    if (user.role !== 'employee') {
      return Response.json({ error: 'Only employees can perform timer actions' }, { status: 403 });
    }

    switch (action) {
      case 'start': {
        if (!projectId || !taskName?.trim()) {
          return Response.json({ error: 'projectId and taskName required for start' }, { status: 400 });
        }
        const { task, timeLog } = await taskService.startTask(user.id, projectId, taskName.trim());
        const project = await projectService.findById(projectId);
        if (project) {
          notificationService
            .notifyTaskStarted(user as any, task, project, new Date(timeLog.started_at))
            .catch((err) => logger.error('notifyTaskStarted failed', err));
        }
        return Response.json({ ok: true, task, timeLog });
      }

      case 'pause': {
        const { task, timeLog } = await taskService.pauseTask(user.id);
        return Response.json({ ok: true, task, timeLog });
      }

      case 'resume': {
        const { task, timeLog } = await taskService.resumeTask(user.id);
        return Response.json({ ok: true, task, timeLog });
      }

      case 'complete': {
        const { task, totalTime } = await taskService.completeTask(user.id);
        const attachments = await storageService.getAttachments(task.id);
        const project = await projectService.findById(task.project_id);
        if (project) {
          notificationService
            .notifyTaskCompleted(user as any, task, project, totalTime, attachments)
            .catch((err) => logger.error('notifyTaskCompleted failed', err));
        }
        return Response.json({ ok: true, task, totalTime });
      }

      default:
        return Response.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (err) {
    if (err instanceof ActiveTaskExistsError) {
      return Response.json({ error: 'active_task_exists' }, { status: 409 });
    }
    if (err instanceof NoActiveTaskError) {
      return Response.json({ error: 'no_active_task' }, { status: 404 });
    }
    if (err instanceof NoPausedTaskError) {
      return Response.json({ error: 'no_paused_task' }, { status: 404 });
    }
    logger.error('Timer POST error', err);
    return Response.json({ error: 'Internal error' }, { status: 500 });
  }
}
