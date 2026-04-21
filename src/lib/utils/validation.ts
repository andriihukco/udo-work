/**
 * Input validation utilities for the Telegram Time Tracker.
 */

import type { UserRole } from '../../types/index';

/**
 * Validates a task name.
 * Returns true if the name is between 1 and 200 characters (inclusive).
 * Returns false for empty strings or strings longer than 200 characters.
 */
export function validateTaskName(name: string): boolean {
  return name.length >= 1 && name.length <= 200;
}

/**
 * Type guard that validates a user role string.
 * Returns true only if the value is exactly 'admin' or 'employee'.
 */
export function validateRole(role: string): role is UserRole {
  return role === 'admin' || role === 'employee';
}
