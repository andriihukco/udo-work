/**
 * UserService — manages user records in the `users` table.
 *
 * Responsibilities:
 *  - findByTelegramId: look up a user by their Telegram ID
 *  - createUser: insert a new user row after validating the role
 *  - getAllEmployeesWithWeeklyTime: aggregate weekly minutes per employee
 *  - getDisplayName: derive a human-readable name from a User record
 */

import { supabase } from '@/lib/db/client';
import { logger } from '@/lib/utils/logger';
import { validateRole } from '@/lib/utils/validation';
import { getStartOfWeek } from '@/lib/utils/time';
import { DatabaseError, User, UserRole, ValidationError } from '@/types/index';
import type { UserRow, TimeLogRow } from '@/lib/db/types';

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface UserService {
  /** Find a user by their Telegram ID; returns null if not found. */
  findByTelegramId(telegramId: number): Promise<User | null>;

  /** Find a user by their username (without @); returns null if not found. */
  findByUsername(username: string): Promise<User | null>;

  /**
   * Create a new user.
   * Throws `ValidationError` if `role` is not a valid `UserRole`.
   */
  createUser(
    telegramId: number,
    role: string,
    firstName?: string,
    username?: string
  ): Promise<User>;

  /**
   * Returns all employees with their total logged minutes for the current
   * week (Monday 00:00 UTC+2 → now).
   */
  getAllEmployeesWithWeeklyTime(): Promise<Array<User & { weeklyMinutes: number }>>;

  /** Returns all admins. */
  getAllAdmins(): Promise<User[]>;

  /** Returns all employees. */
  getAllEmployees(): Promise<User[]>;

  /** Deletes a user by their internal UUID. */
  deleteUser(userId: string): Promise<void>;

  /** Updates a user's role. */
  updateRole(userId: string, role: UserRole): Promise<void>;

  /** Updates a user's display name. */
  updateFirstName(userId: string, firstName: string): Promise<void>;

  /**
   * Returns the best available display name for a user:
   *   1. first_name (if set)
   *   2. @username (if set, prefixed with @)
   *   3. telegram_id as a string
   */
  getDisplayName(user: User): string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Maps a raw `UserRow` to the domain `User` type. */
function mapRow(row: UserRow): User {
  return {
    id: row.id,
    telegram_id: row.telegram_id,
    role: row.role,
    first_name: row.first_name,
    username: row.username,
    created_at: row.created_at,
  };
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export const userService: UserService = {
  /**
   * Queries the `users` table for a row matching `telegram_id`.
   * Returns `null` when no row is found (PGRST116 = "no rows returned").
   */
  async findByTelegramId(telegramId: number): Promise<User | null> {
    const { data, error } = await supabase
      .from('users')
      .select('id, telegram_id, role, first_name, username, created_at')
      .eq('telegram_id', telegramId)
      .maybeSingle();

    if (error) {
      logger.error('UserService.findByTelegramId failed', error);
      throw new DatabaseError('Failed to find user by Telegram ID');
    }

    return data ? mapRow(data as UserRow) : null;
  },

  async findByUsername(username: string): Promise<User | null> {
    const clean = username.replace(/^@/, '').toLowerCase();
    const { data, error } = await supabase
      .from('users')
      .select('id, telegram_id, role, first_name, username, created_at')
      .ilike('username', clean)
      .maybeSingle();

    if (error) {
      logger.error('UserService.findByUsername failed', error);
      throw new DatabaseError('Failed to find user by username');
    }

    return data ? mapRow(data as UserRow) : null;
  },

  /**
   * Validates `role` then inserts a new row into `users`.
   * Throws `ValidationError` for invalid roles.
   */
  async createUser(
    telegramId: number,
    role: string,
    firstName?: string,
    username?: string
  ): Promise<User> {
    if (!validateRole(role)) {
      throw new ValidationError(`Invalid role: "${role}". Must be "admin" or "employee".`);
    }

    const { data, error } = await supabase
      .from('users')
      .insert({
        telegram_id: telegramId,
        role: role as UserRole,
        first_name: firstName ?? null,
        username: username ?? null,
      })
      .select('id, telegram_id, role, first_name, username, created_at')
      .single();

    if (error || !data) {
      logger.error('UserService.createUser failed', error);
      throw new DatabaseError('Failed to create user');
    }

    return mapRow(data as UserRow);
  },

  /**
   * Aggregates weekly minutes for every employee.
   *
   * Strategy:
   *  1. Fetch all users with role = 'employee'.
   *  2. Fetch all time_logs (via tasks) where started_at >= start of current week (UTC+2).
   *  3. For each log, compute duration = (paused_at ?? ended_at) - started_at.
   *     Open intervals (no end timestamp) are skipped.
   *  4. Group durations by user_id and sum.
   *
   * We do this in two queries to avoid complex Supabase join syntax and keep
   * the logic transparent and testable.
   */
  async getAllEmployeesWithWeeklyTime(): Promise<Array<User & { weeklyMinutes: number }>> {
    // Step 1: fetch all employees
    const { data: employeeRows, error: empError } = await supabase
      .from('users')
      .select('id, telegram_id, role, first_name, username, created_at')
      .eq('role', 'employee');

    if (empError) {
      logger.error('UserService.getAllEmployeesWithWeeklyTime — users query failed', empError);
      throw new DatabaseError('Failed to fetch employees');
    }

    const employees = (employeeRows ?? []) as UserRow[];

    if (employees.length === 0) {
      return [];
    }

    // Step 2: fetch tasks for these employees that have time_logs within the current week
    const weekStart = getStartOfWeek().toISOString();
    const employeeIds = employees.map((e) => e.id);

    // Fetch tasks belonging to these employees
    const { data: taskRows, error: taskError } = await supabase
      .from('tasks')
      .select('id, user_id')
      .in('user_id', employeeIds);

    if (taskError) {
      logger.error('UserService.getAllEmployeesWithWeeklyTime — tasks query failed', taskError);
      throw new DatabaseError('Failed to fetch tasks for employees');
    }

    const tasks = (taskRows ?? []) as Array<{ id: string; user_id: string }>;

    if (tasks.length === 0) {
      // No tasks at all — return employees with 0 minutes
      return employees.map((e) => ({ ...mapRow(e), weeklyMinutes: 0 }));
    }

    const taskIds = tasks.map((t) => t.id);

    // Build a map from task_id → user_id for quick lookup
    const taskUserMap = new Map<string, string>(tasks.map((t) => [t.id, t.user_id]));

    // Step 3: fetch time_logs for those tasks that started within the current week
    const { data: logRows, error: logError } = await supabase
      .from('time_logs')
      .select('id, task_id, started_at, paused_at, ended_at')
      .in('task_id', taskIds)
      .gte('started_at', weekStart);

    if (logError) {
      logger.error('UserService.getAllEmployeesWithWeeklyTime — time_logs query failed', logError);
      throw new DatabaseError('Failed to fetch time logs for employees');
    }

    const logs = (logRows ?? []) as TimeLogRow[];

    // Step 4: aggregate minutes per user_id
    const minutesByUser = new Map<string, number>();

    for (const log of logs) {
      const userId = taskUserMap.get(log.task_id);
      if (!userId) continue;

      const endStr = log.paused_at ?? log.ended_at;
      if (!endStr) continue; // open interval — skip

      const startMs = new Date(log.started_at).getTime();
      const endMs = new Date(endStr).getTime();
      const diffMs = endMs - startMs;
      if (diffMs <= 0) continue;

      const diffMinutes = Math.floor(diffMs / 60_000);
      minutesByUser.set(userId, (minutesByUser.get(userId) ?? 0) + diffMinutes);
    }

    // Step 5: merge employees with their weekly minutes
    return employees.map((e) => ({
      ...mapRow(e),
      weeklyMinutes: minutesByUser.get(e.id) ?? 0,
    }));
  },

  /**
   * Returns all users with role = 'admin'.
   */
  async getAllAdmins(): Promise<User[]> {
    const { data, error } = await supabase
      .from('users')
      .select('id, telegram_id, role, first_name, username, created_at')
      .eq('role', 'admin');

    if (error) {
      logger.error('UserService.getAllAdmins failed', error);
      throw new DatabaseError('Failed to fetch admins');
    }

    return (data ?? []).map((row) => mapRow(row as UserRow));
  },

  /**
   * Returns all users with role = 'employee'.
   */
  async getAllEmployees(): Promise<User[]> {
    const { data, error } = await supabase
      .from('users')
      .select('id, telegram_id, role, first_name, username, created_at')
      .eq('role', 'employee')
      .order('first_name', { ascending: true });

    if (error) {
      logger.error('UserService.getAllEmployees failed', error);
      throw new DatabaseError('Failed to fetch employees');
    }

    return (data ?? []).map((row) => mapRow(row as UserRow));
  },

  /**
   * Deletes a user by their internal UUID.
   */
  async deleteUser(userId: string): Promise<void> {
    const { error } = await supabase
      .from('users')
      .delete()
      .eq('id', userId);

    if (error) {
      logger.error('UserService.deleteUser failed', error);
      throw new DatabaseError('Failed to delete user');
    }
  },

  async updateRole(userId: string, role: UserRole): Promise<void> {
    const { error } = await supabase
      .from('users')
      .update({ role })
      .eq('id', userId);

    if (error) {
      logger.error('UserService.updateRole failed', error);
      throw new DatabaseError('Failed to update user role');
    }
  },

  async updateFirstName(userId: string, firstName: string): Promise<void> {
    const { error } = await supabase
      .from('users')
      .update({ first_name: firstName })
      .eq('id', userId);

    if (error) {
      logger.error('UserService.updateFirstName failed', error);
      throw new DatabaseError('Failed to update user name');
    }
  },

  /**
   * Returns the most descriptive available name for a user:
   *   - first_name if non-null and non-empty
   *   - @username if non-null and non-empty
   *   - telegram_id.toString() as a last resort
   */
  getDisplayName(user: User): string {
    if (user.first_name) return user.first_name;
    if (user.username) return `@${user.username}`;
    return `ID ${user.telegram_id}`;
  },
};
