/**
 * TaskService — manages task lifecycle and time logging in the `tasks` and `time_logs` tables.
 *
 * Responsibilities:
 *  - startTask: validate task name, check no active task exists, create task + initial time log
 *  - pauseTask: find in_progress task, close latest open time log with paused_at, set status = 'paused'
 *  - resumeTask: find paused task, insert new time log with started_at, set status = 'in_progress'
 *  - completeTask: find active/paused task, close latest open log with ended_at, set status = 'completed'
 *  - getActiveTask: return task with status in_progress or paused, or null
 *  - getTasksForUser: return TaskActivity[] with joined project name and computed time
 *  - getTasksWithFilters: paginated query with optional projectId/userId filters
 *  - getTimeLogs: return all time_logs for a task ordered by started_at
 *  - calculateTotalTime: delegate to time utility
 */

import { supabase } from '@/lib/db/client';
import { logger } from '@/lib/utils/logger';
import { validateTaskName } from '@/lib/utils/validation';
import { calculateTotalTime as calcTotalTime } from '@/lib/utils/time';
import {
  ActiveTaskExistsError,
  DatabaseError,
  NoActiveTaskError,
  NoPausedTaskError,
  Task,
  TaskActivity,
  TimeLog,
  TimeSpent,
  ValidationError,
} from '@/types/index';
import type { TaskRow, TimeLogRow } from '@/lib/db/types';

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface TaskService {
  /** Start a new task; throws ValidationError if name invalid, ActiveTaskExistsError if one already in_progress. */
  startTask(
    userId: string,
    projectId: string,
    taskName: string
  ): Promise<{ task: Task; timeLog: TimeLog }>;

  /** Pause the in_progress task; throws NoActiveTaskError if none found. */
  pauseTask(userId: string): Promise<{ task: Task; timeLog: TimeLog }>;

  /** Resume the paused task; throws NoPausedTaskError if none found. */
  resumeTask(userId: string): Promise<{ task: Task; timeLog: TimeLog }>;

  /** Complete a task (in_progress or paused); returns task and total time. */
  completeTask(userId: string): Promise<{ task: Task; totalTime: TimeSpent }>;

  /** Return the active or paused task for a user, or null. */
  getActiveTask(userId: string): Promise<Task | null>;

  /** Return TaskActivity[] for a user within a date range. */
  getTasksForUser(userId: string, from: Date, to: Date): Promise<TaskActivity[]>;

  /** Paginated task query with optional filters; page is 0-indexed, 10 per page. */
  getTasksWithFilters(
    filters: { projectId?: string; userId?: string },
    page: number
  ): Promise<{ tasks: Task[]; total: number }>;

  /** Return all time_logs for a task ordered by started_at. */
  getTimeLogs(taskId: string): Promise<TimeLog[]>;

  /** Calculate total time spent across a set of time logs. */
  calculateTotalTime(timeLogs: TimeLog[]): TimeSpent;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PAGE_SIZE = 10;

/** Maps a raw TaskRow to the domain Task type. */
function mapTaskRow(row: TaskRow): Task {
  return {
    id: row.id,
    project_id: row.project_id,
    user_id: row.user_id,
    name: row.name,
    status: row.status,
    created_at: row.created_at,
  };
}

/** Maps a raw TimeLogRow to the domain TimeLog type. */
function mapTimeLogRow(row: TimeLogRow): TimeLog {
  return {
    id: row.id,
    task_id: row.task_id,
    started_at: row.started_at,
    paused_at: row.paused_at ?? null,
    ended_at: row.ended_at ?? null,
  };
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export const taskService: TaskService = {
  /**
   * Validates the task name, checks no in_progress task exists for the user,
   * then inserts a tasks row (status = 'in_progress') and a time_logs row (started_at = NOW()).
   */
  async startTask(
    userId: string,
    projectId: string,
    taskName: string
  ): Promise<{ task: Task; timeLog: TimeLog }> {
    // Validate task name length (1–200 chars)
    if (!validateTaskName(taskName)) {
      throw new ValidationError('Task name must be between 1 and 200 characters');
    }

    // Check for existing in_progress task
    const { data: existingTask, error: checkError } = await supabase
      .from('tasks')
      .select('id')
      .eq('user_id', userId)
      .eq('status', 'in_progress')
      .maybeSingle();

    if (checkError) {
      logger.error('TaskService.startTask: failed to check existing task', checkError);
      throw new DatabaseError('Failed to check for existing active task');
    }

    if (existingTask) {
      throw new ActiveTaskExistsError();
    }

    // Insert the task
    const { data: taskData, error: taskError } = await supabase
      .from('tasks')
      .insert({
        project_id: projectId,
        user_id: userId,
        name: taskName,
        status: 'in_progress',
      })
      .select('id, project_id, user_id, name, status, created_at')
      .single();

    if (taskError || !taskData) {
      logger.error('TaskService.startTask: failed to insert task', taskError);
      throw new DatabaseError('Failed to create task');
    }

    const task = mapTaskRow(taskData as TaskRow);

    // Insert the initial time log
    const { data: logData, error: logError } = await supabase
      .from('time_logs')
      .insert({
        task_id: task.id,
        started_at: new Date().toISOString(),
      })
      .select('id, task_id, started_at, paused_at, ended_at')
      .single();

    if (logError || !logData) {
      logger.error('TaskService.startTask: failed to insert time log', logError);
      throw new DatabaseError('Failed to create time log');
    }

    const timeLog = mapTimeLogRow(logData as TimeLogRow);

    return { task, timeLog };
  },

  /**
   * Finds the in_progress task for the user, updates the latest open time log
   * with paused_at = NOW(), and sets task status = 'paused'.
   */
  async pauseTask(userId: string): Promise<{ task: Task; timeLog: TimeLog }> {
    // Find in_progress task
    const { data: taskData, error: taskError } = await supabase
      .from('tasks')
      .select('id, project_id, user_id, name, status, created_at')
      .eq('user_id', userId)
      .eq('status', 'in_progress')
      .maybeSingle();

    if (taskError) {
      logger.error('TaskService.pauseTask: failed to find active task', taskError);
      throw new DatabaseError('Failed to find active task');
    }

    if (!taskData) {
      throw new NoActiveTaskError();
    }

    const taskId = taskData.id;

    // Find the latest open time log (paused_at IS NULL AND ended_at IS NULL)
    const { data: logData, error: logError } = await supabase
      .from('time_logs')
      .select('id, task_id, started_at, paused_at, ended_at')
      .eq('task_id', taskId)
      .is('paused_at', null)
      .is('ended_at', null)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (logError) {
      logger.error('TaskService.pauseTask: failed to find open time log', logError);
      throw new DatabaseError('Failed to find open time log');
    }

    if (!logData) {
      logger.error('TaskService.pauseTask: no open time log found for task', taskId);
      throw new DatabaseError('No open time log found for active task');
    }

    const now = new Date().toISOString();

    // Update the time log with paused_at
    const { data: updatedLog, error: updateLogError } = await supabase
      .from('time_logs')
      .update({ paused_at: now })
      .eq('id', logData.id)
      .select('id, task_id, started_at, paused_at, ended_at')
      .single();

    if (updateLogError || !updatedLog) {
      logger.error('TaskService.pauseTask: failed to update time log', updateLogError);
      throw new DatabaseError('Failed to update time log');
    }

    // Update task status to paused
    const { data: updatedTask, error: updateTaskError } = await supabase
      .from('tasks')
      .update({ status: 'paused' })
      .eq('id', taskId)
      .select('id, project_id, user_id, name, status, created_at')
      .single();

    if (updateTaskError || !updatedTask) {
      logger.error('TaskService.pauseTask: failed to update task status', updateTaskError);
      throw new DatabaseError('Failed to update task status');
    }

    return {
      task: mapTaskRow(updatedTask as TaskRow),
      timeLog: mapTimeLogRow(updatedLog as TimeLogRow),
    };
  },

  /**
   * Finds the paused task for the user, inserts a new time log with started_at = NOW(),
   * and sets task status = 'in_progress'.
   */
  async resumeTask(userId: string): Promise<{ task: Task; timeLog: TimeLog }> {
    // Find paused task
    const { data: taskData, error: taskError } = await supabase
      .from('tasks')
      .select('id, project_id, user_id, name, status, created_at')
      .eq('user_id', userId)
      .eq('status', 'paused')
      .maybeSingle();

    if (taskError) {
      logger.error('TaskService.resumeTask: failed to find paused task', taskError);
      throw new DatabaseError('Failed to find paused task');
    }

    if (!taskData) {
      throw new NoPausedTaskError();
    }

    const taskId = taskData.id;
    const now = new Date().toISOString();

    // Insert a new time log
    const { data: logData, error: logError } = await supabase
      .from('time_logs')
      .insert({
        task_id: taskId,
        started_at: now,
      })
      .select('id, task_id, started_at, paused_at, ended_at')
      .single();

    if (logError || !logData) {
      logger.error('TaskService.resumeTask: failed to insert time log', logError);
      throw new DatabaseError('Failed to create time log');
    }

    // Update task status to in_progress
    const { data: updatedTask, error: updateTaskError } = await supabase
      .from('tasks')
      .update({ status: 'in_progress' })
      .eq('id', taskId)
      .select('id, project_id, user_id, name, status, created_at')
      .single();

    if (updateTaskError || !updatedTask) {
      logger.error('TaskService.resumeTask: failed to update task status', updateTaskError);
      throw new DatabaseError('Failed to update task status');
    }

    return {
      task: mapTaskRow(updatedTask as TaskRow),
      timeLog: mapTimeLogRow(logData as TimeLogRow),
    };
  },

  /**
   * Finds the in_progress or paused task for the user, sets ended_at = NOW() on the
   * latest open time log, sets task status = 'completed', and returns the task + total time.
   */
  async completeTask(userId: string): Promise<{ task: Task; totalTime: TimeSpent }> {
    // Find in_progress or paused task
    const { data: taskData, error: taskError } = await supabase
      .from('tasks')
      .select('id, project_id, user_id, name, status, created_at')
      .eq('user_id', userId)
      .in('status', ['in_progress', 'paused'])
      .maybeSingle();

    if (taskError) {
      logger.error('TaskService.completeTask: failed to find active/paused task', taskError);
      throw new DatabaseError('Failed to find active or paused task');
    }

    if (!taskData) {
      throw new NoActiveTaskError();
    }

    const taskId = taskData.id;
    const now = new Date().toISOString();

    // Find the latest open time log (ended_at IS NULL)
    const { data: logData, error: logError } = await supabase
      .from('time_logs')
      .select('id, task_id, started_at, paused_at, ended_at')
      .eq('task_id', taskId)
      .is('ended_at', null)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (logError) {
      logger.error('TaskService.completeTask: failed to find open time log', logError);
      throw new DatabaseError('Failed to find open time log');
    }

    // Update the open time log with ended_at (if one exists)
    if (logData) {
      const { error: updateLogError } = await supabase
        .from('time_logs')
        .update({ ended_at: now })
        .eq('id', logData.id);

      if (updateLogError) {
        logger.error('TaskService.completeTask: failed to update time log', updateLogError);
        throw new DatabaseError('Failed to update time log');
      }
    }

    // Update task status to completed
    const { data: updatedTask, error: updateTaskError } = await supabase
      .from('tasks')
      .update({ status: 'completed' })
      .eq('id', taskId)
      .select('id, project_id, user_id, name, status, created_at')
      .single();

    if (updateTaskError || !updatedTask) {
      logger.error('TaskService.completeTask: failed to update task status', updateTaskError);
      throw new DatabaseError('Failed to update task status');
    }

    const task = mapTaskRow(updatedTask as TaskRow);

    // Fetch all time logs and calculate total time
    const timeLogs = await taskService.getTimeLogs(taskId);
    const totalTime = calcTotalTime(timeLogs);

    return { task, totalTime };
  },

  /**
   * Returns the task with status in_progress or paused for the user, or null if none.
   */
  async getActiveTask(userId: string): Promise<Task | null> {
    const { data, error } = await supabase
      .from('tasks')
      .select('id, project_id, user_id, name, status, created_at')
      .eq('user_id', userId)
      .in('status', ['in_progress', 'paused'])
      .maybeSingle();

    if (error) {
      logger.error('TaskService.getActiveTask failed', error);
      throw new DatabaseError('Failed to get active task');
    }

    return data ? mapTaskRow(data as TaskRow) : null;
  },

  /**
   * Returns TaskActivity[] for a user within a date range, joining project name
   * and computing timeSpent for each task.
   * Only counts time logged within the [from, to] range.
   */
  async getTasksForUser(userId: string, from: Date, to: Date): Promise<TaskActivity[]> {
    // Query tasks that have at least one time_log started within the range
    const { data, error } = await supabase
      .from('tasks')
      .select(
        `id, project_id, user_id, name, status, created_at,
         projects!inner(name),
         time_logs!inner(started_at)`
      )
      .eq('user_id', userId)
      .gte('time_logs.started_at', from.toISOString())
      .lte('time_logs.started_at', to.toISOString());

    if (error) {
      logger.error('TaskService.getTasksForUser failed', error);
      throw new DatabaseError('Failed to get tasks for user');
    }

    if (!data || data.length === 0) {
      return [];
    }

    // Deduplicate tasks (a task may appear multiple times due to multiple time_logs)
    const seenTaskIds = new Set<string>();
    const uniqueTasks: typeof data = [];
    for (const row of data) {
      if (!seenTaskIds.has(row.id)) {
        seenTaskIds.add(row.id);
        uniqueTasks.push(row);
      }
    }

    // Build TaskActivity for each unique task
    const activities: TaskActivity[] = await Promise.all(
      uniqueTasks.map(async (row) => {
        // Fetch only time logs within the requested date range for consistent counting
        const { data: logsData } = await supabase
          .from('time_logs')
          .select('id, task_id, started_at, paused_at, ended_at')
          .eq('task_id', row.id)
          .gte('started_at', from.toISOString())
          .lte('started_at', to.toISOString())
          .order('started_at', { ascending: true });

        const timeLogs = (logsData ?? []).map(mapTimeLogRow);
        const timeSpent = calcTotalTime(timeLogs);

        // Extract project name from the join
        const projectsJoin = row.projects as unknown as { name: string } | { name: string }[];
        const projectName = Array.isArray(projectsJoin)
          ? projectsJoin[0]?.name ?? ''
          : projectsJoin?.name ?? '';

        // Use the earliest time_log started_at as the task's startedAt
        const timeLogsJoin = row.time_logs as unknown as { started_at: string }[];
        const startedAt = Array.isArray(timeLogsJoin) && timeLogsJoin.length > 0
          ? timeLogsJoin.reduce((earliest, tl) =>
              tl.started_at < earliest ? tl.started_at : earliest,
              timeLogsJoin[0].started_at
            )
          : row.created_at;

        return {
          taskId: row.id,
          taskName: row.name,
          projectName,
          status: row.status,
          timeSpent,
          startedAt,
        };
      })
    );

    return activities;
  },

  /**
   * Returns a paginated list of tasks with optional projectId/userId filters.
   * Page is 0-indexed; returns 10 tasks per page.
   */
  async getTasksWithFilters(
    filters: { projectId?: string; userId?: string },
    page: number
  ): Promise<{ tasks: Task[]; total: number }> {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    let query = supabase
      .from('tasks')
      .select('id, project_id, user_id, name, status, created_at', { count: 'exact' });

    if (filters.projectId) {
      query = query.eq('project_id', filters.projectId);
    }

    if (filters.userId) {
      query = query.eq('user_id', filters.userId);
    }

    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) {
      logger.error('TaskService.getTasksWithFilters failed', error);
      throw new DatabaseError('Failed to get tasks with filters');
    }

    return {
      tasks: (data ?? []).map((row) => mapTaskRow(row as TaskRow)),
      total: count ?? 0,
    };
  },

  /**
   * Returns all time_logs for a task ordered by started_at ascending.
   */
  async getTimeLogs(taskId: string): Promise<TimeLog[]> {
    const { data, error } = await supabase
      .from('time_logs')
      .select('id, task_id, started_at, paused_at, ended_at')
      .eq('task_id', taskId)
      .order('started_at', { ascending: true });

    if (error) {
      logger.error('TaskService.getTimeLogs failed', error);
      throw new DatabaseError('Failed to get time logs');
    }

    return (data ?? []).map((row) => mapTimeLogRow(row as TimeLogRow));
  },

  /**
   * Delegates to the calculateTotalTime utility from src/lib/utils/time.ts.
   */
  calculateTotalTime(timeLogs: TimeLog[]): TimeSpent {
    return calcTotalTime(timeLogs);
  },
};
