/**
 * Inline keyboard builders for the Telegram Time Tracker bot.
 * Exports static keyboards and dynamic builder functions.
 * Requirements: 3.1, 8.1, 9.1, 10.1, 10.5
 */

import type { Project, User, Task } from '@/types';
import type { InlineKeyboardMarkup } from './types';

// ---------------------------------------------------------------------------
// Static keyboards
// ---------------------------------------------------------------------------

/** Main menu shown to employees. */
export const EMPLOYEE_MAIN_MENU: InlineKeyboardMarkup = {
  inline_keyboard: [
    [{ text: '▶️ Почати задачу', callback_data: 'action:start_task' }],
    [{ text: '⏸ Пауза', callback_data: 'action:pause_task' }],
    [{ text: '▶️ Відновити', callback_data: 'action:resume_task' }],
    [{ text: '✅ Завершити задачу', callback_data: 'action:complete_task' }],
    [{ text: '📊 Моя активність', callback_data: 'action:my_activity' }],
  ],
};

/** Main menu shown to admins. */
export const ADMIN_MAIN_MENU: InlineKeyboardMarkup = {
  inline_keyboard: [
    [{ text: '📁 Створити проєкт', callback_data: 'action:create_project' }],
    [{ text: '🚫 Деактивувати проєкт', callback_data: 'action:deactivate_project' }],
    [{ text: '👥 Співробітники', callback_data: 'action:employees' }],
    [{ text: '📋 Задачі та логи', callback_data: 'action:tasks_logs' }],
    [{ text: '🔑 Управління користувачами', callback_data: 'action:manage_admins' }],
    [{ text: '🔗 Запросити до проєкту', callback_data: 'action:invite_to_project' }],
  ],
};

/** Admin management keyboard. */
export const MANAGE_USERS_KEYBOARD: InlineKeyboardMarkup = {
  inline_keyboard: [
    [{ text: '➕ Додати адміна', callback_data: 'action:add_admin' }],
    [{ text: '➕ Додати співробітника', callback_data: 'action:add_employee' }],
    [{ text: '🗑 Видалити адміна', callback_data: 'action:remove_admin' }],
    [{ text: '◀️ Назад', callback_data: 'action:back_to_main' }],
  ],
};

/** Period selector shown when an employee requests their activity report. */
export const ACTIVITY_PERIOD_KEYBOARD: InlineKeyboardMarkup = {
  inline_keyboard: [
    [{ text: '📅 Сьогодні', callback_data: 'period:today' }],
    [{ text: '📆 Цей тиждень', callback_data: 'period:week' }],
    [{ text: '◀️ Назад', callback_data: 'action:back_to_main' }],
  ],
};

/** Asks the employee whether they want to attach a deliverable before completing a task. */
export const DELIVERABLE_CHOICE_KEYBOARD: InlineKeyboardMarkup = {
  inline_keyboard: [
    [{ text: '📎 Так', callback_data: 'deliverable:yes' }],
    [{ text: '⏭ Пропустити', callback_data: 'deliverable:skip' }],
  ],
};

/** Shown after each deliverable is saved — lets the employee add more or finish. */
export const ADD_MORE_KEYBOARD: InlineKeyboardMarkup = {
  inline_keyboard: [
    [{ text: '➕ Додати ще', callback_data: 'deliverable:add_more' }],
    [{ text: '✅ Завершити', callback_data: 'deliverable:finish' }],
  ],
};

// ---------------------------------------------------------------------------
// Dynamic keyboard builders
// ---------------------------------------------------------------------------

/**
 * Builds a keyboard listing active projects for task-start selection.
 * Each button carries `project:{id}` as callback_data by default,
 * or `{callbackPrefix}:{id}` if callbackPrefix is provided.
 * Requirements: 3.1
 */
export function buildProjectKeyboard(projects: Project[], backAction = 'action:back_to_main', callbackPrefix = 'project'): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      ...projects.map((p) => [
        { text: p.name, callback_data: `${callbackPrefix}:${p.id}` },
      ]),
      [{ text: '◀️ Назад', callback_data: backAction }],
    ],
  };
}

/**
 * Builds a keyboard listing employees.
 * Each button carries `employee:{id}` as callback_data.
 * Requirements: 9.1
 */
export function buildEmployeeListKeyboard(employees: User[], backAction = 'action:employees'): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      ...employees.map((e) => {
        const name = e.first_name ?? (e.username ? `@${e.username}` : `ID ${e.telegram_id}`);
        const suffix = e.username && e.first_name ? ` (@${e.username})` : '';
        return [{ text: `${name}${suffix}`, callback_data: `employee:${e.id}` }];
      }),
      [{ text: '◀️ Назад', callback_data: backAction }],
    ],
  };
}

/**
 * Builds a keyboard listing tasks.
 * Each button carries `task:{id}` as callback_data.
 * Requirements: 10.1
 */
export function buildTaskListKeyboard(tasks: Task[], backAction = 'action:tasks_logs'): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      ...tasks.map((t) => [
        { text: t.name, callback_data: `task:${t.id}` },
      ]),
      [{ text: '◀️ Назад', callback_data: backAction }],
    ],
  };
}

/**
 * Builds a pagination keyboard for lists longer than 10 items.
 * Shows "◀️ Назад" and/or "Вперед ▶️" buttons as appropriate.
 * `prefix` is prepended to the page callback_data (e.g. "tasks", "employees").
 * Requirements: 10.5
 */
export function buildPaginationKeyboard(
  page: number,
  totalPages: number,
  prefix: string,
): InlineKeyboardMarkup {
  const buttons = [];

  if (page > 0) {
    buttons.push({ text: '◀️ Назад', callback_data: `page:${prefix}:${page - 1}` });
  }
  if (page < totalPages - 1) {
    buttons.push({ text: 'Вперед ▶️', callback_data: `page:${prefix}:${page + 1}` });
  }

  return { inline_keyboard: buttons.length > 0 ? [buttons] : [] };
}

/**
 * Builds the filter keyboard shown in the "Задачі та логи" admin flow.
 * Requirements: 10.1
 */
export function buildFilterKeyboard(): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: '📋 Всі', callback_data: 'filter:all' }],
      [{ text: '📁 За проєктом', callback_data: 'filter:by_project' }],
      [{ text: '👤 За співробітником', callback_data: 'filter:by_employee' }],
      [{ text: '◀️ Назад', callback_data: 'action:back_to_main' }],
    ],
  };
}

/**
 * Builds a keyboard listing admins for removal.
 * Each button carries `remove_admin:{id}` as callback_data.
 */
export function buildAdminListKeyboard(admins: User[]): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      ...admins.map((a) => {
        const label = a.first_name ?? (a.username ? `@${a.username}` : String(a.telegram_id));
        return [{ text: `🗑 ${label}`, callback_data: `remove_admin:${a.id}` }];
      }),
      [{ text: '◀️ Назад', callback_data: 'action:manage_admins' }],
    ],
  };
}

/**
 * Builds a keyboard for selecting invite role.
 */
export function buildInviteRoleKeyboard(projectId: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: '👤 Співробітник', callback_data: `invite_role:${projectId}:employee` }],
      [{ text: '🔑 Адмін', callback_data: `invite_role:${projectId}:admin` }],
      [{ text: '◀️ Назад', callback_data: 'action:invite_to_project' }],
    ],
  };
}
