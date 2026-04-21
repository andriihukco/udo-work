/**
 * Ukrainian message constants for the Telegram Time Tracker bot.
 *
 * All user-facing strings are defined here. Never inline strings in other files —
 * always reference a key from this MESSAGES object.
 *
 * Some values are template functions that accept dynamic parameters (task name,
 * project name, time, etc.) and return a formatted Ukrainian string.
 */

import { formatDateTime, formatTimeSpent } from './utils/time';
import type { TimeSpent } from '../types/index';

// ---------------------------------------------------------------------------
// MESSAGES object
// ---------------------------------------------------------------------------

export const MESSAGES = {
  // -------------------------------------------------------------------------
  // Access / Registration (Req 1.2, 15.2, 15.3, 16.5)
  // -------------------------------------------------------------------------

  /**
   * Sent when a message arrives from a user whose telegram_id is not in the
   * `users` table. No DB actions are performed after this message.
   * Req 1.2, 16.5
   */
  NOT_REGISTERED:
    '👋 Вітаємо! Вас ще не зареєстровано в системі.\n' +
    'Будь ласка, зверніться до адміністратора для отримання доступу.',

  /**
   * Sent when a registered user attempts an action they are not authorised to
   * perform (e.g. employee tries an admin action, or vice-versa).
   * Req 15.2, 15.3
   */
  NO_PERMISSION: '🚫 У вас немає прав для виконання цієї дії.',

  // -------------------------------------------------------------------------
  // Welcome / Main menus (Req 1.2, 1.5)
  // -------------------------------------------------------------------------

  /**
   * Generic welcome / greeting shown after /start for a registered user.
   */
  WELCOME: '👋 Вітаємо! Оберіть дію з меню нижче.',

  /**
   * Caption shown above the employee main-menu inline keyboard.
   */
  MAIN_MENU_EMPLOYEE: '📋 Головне меню. Оберіть дію:',

  /**
   * Caption shown above the admin main-menu inline keyboard.
   */
  MAIN_MENU_ADMIN: '⚙️ Панель адміністратора. Оберіть дію:',

  // -------------------------------------------------------------------------
  // Project management (Req 2.2, 2.3, 16.3)
  // -------------------------------------------------------------------------

  /**
   * Sent when an employee tries to start a task but there are no active
   * projects in the database.
   * Req 16.3
   */
  NO_ACTIVE_PROJECTS:
    '📭 Наразі немає активних проєктів.\n' +
    'Будь ласка, зверніться до адміністратора.',

  /**
   * Sent when an admin tries to create a project whose name already exists.
   * Req 2.2
   */
  DUPLICATE_PROJECT:
    '⚠️ Проєкт із такою назвою вже існує. Будь ласка, введіть іншу назву.',

  /**
   * Sent after a project is successfully created.
   * Accepts the project name as a parameter.
   * Req 2.1
   */
  PROJECT_CREATED: (projectName: string): string =>
    `✅ Проєкт *${projectName}* успішно створено.`,

  /**
   * Sent after a project is successfully deactivated.
   * Accepts the project name as a parameter.
   * Req 2.3
   */
  PROJECT_DEACTIVATED: (projectName: string): string =>
    `🚫 Проєкт *${projectName}* деактивовано.`,

  // -------------------------------------------------------------------------
  // Task lifecycle — start (Req 3.4, 3.5)
  // -------------------------------------------------------------------------

  /**
   * Sent when a task is successfully started.
   * Accepts task name, project name, and start time (Date or ISO string).
   * Req 3.5
   */
  TASK_STARTED: (taskName: string, projectName: string, startedAt: Date | string): string =>
    `▶️ Задачу розпочато!\n\n` +
    `📌 *Задача:* ${taskName}\n` +
    `📁 *Проєкт:* ${projectName}\n` +
    `🕐 *Початок:* ${formatDateTime(startedAt)}`,

  /**
   * Sent when an employee tries to start a task while another task is already
   * in_progress.
   * Req 3.4
   */
  ACTIVE_TASK_EXISTS:
    '⚠️ У вас вже є активна задача.\n' +
    'Спочатку поставте її на паузу або завершіть.',

  // -------------------------------------------------------------------------
  // Task lifecycle — pause (Req 4.2, 4.4)
  // -------------------------------------------------------------------------

  /**
   * Sent when a task is successfully paused.
   * Accepts task name and pause start time (Date or ISO string).
   * Req 4.4
   */
  TASK_PAUSED: (taskName: string, pausedAt: Date | string): string =>
    `⏸ Задачу поставлено на паузу.\n\n` +
    `📌 *Задача:* ${taskName}\n` +
    `🕐 *Час паузи:* ${formatDateTime(pausedAt)}`,

  /**
   * Sent when an employee tries to pause but has no in_progress task.
   * Req 4.2
   */
  NO_ACTIVE_TASK: '❌ Немає активної задачі для паузи.',

  // -------------------------------------------------------------------------
  // Task lifecycle — resume (Req 5.2, 5.4)
  // -------------------------------------------------------------------------

  /**
   * Sent when a task is successfully resumed.
   * Accepts task name and resume time (Date or ISO string).
   * Req 5.4
   */
  TASK_RESUMED: (taskName: string, resumedAt: Date | string): string =>
    `▶️ Задачу відновлено!\n\n` +
    `📌 *Задача:* ${taskName}\n` +
    `🕐 *Час відновлення:* ${formatDateTime(resumedAt)}`,

  /**
   * Sent when an employee tries to resume but has no paused task.
   * Req 5.2
   */
  NO_PAUSED_TASK: '❌ Немає задачі на паузі для відновлення.',

  // -------------------------------------------------------------------------
  // Task lifecycle — complete (Req 6.2, 6.4)
  // -------------------------------------------------------------------------

  /**
   * Sent when a task is successfully completed (deliverable skipped or after
   * all deliverables are saved).
   * Accepts task name and a TimeSpent object.
   * Req 6.4, 6.6
   */
  TASK_COMPLETED: (taskName: string, totalTime: TimeSpent): string =>
    `✅ Задачу завершено!\n\n` +
    `📌 *Задача:* ${taskName}\n` +
    `⏱ *Витрачено часу:* ${formatTimeSpent(totalTime)}`,

  // -------------------------------------------------------------------------
  // Deliverables / Attachments (Req 7.4, 7.6)
  // -------------------------------------------------------------------------

  /**
   * Prompt shown when asking the employee whether they want to attach a
   * deliverable before completing the task.
   */
  ATTACH_DELIVERABLE_PROMPT:
    '📎 Бажаєте прикріпити результати до задачі?\n' +
    'Надішліть файл або текстовий опис, або оберіть дію нижче.',

  /**
   * Sent after a deliverable (file or text) is successfully saved.
   * Asks whether the employee wants to add another one.
   * Req 7.4
   */
  DELIVERABLE_SAVED:
    '✅ Результат збережено!\n\n' +
    'Бажаєте додати ще один результат?',

  // -------------------------------------------------------------------------
  // Activity reporting (Req 8.4)
  // -------------------------------------------------------------------------

  /**
   * Sent when no tasks are found for the requested period (today / this week).
   * Req 8.4
   */
  NO_ACTIVITY: '📭 За обраний період активності не знайдено.',

  // -------------------------------------------------------------------------
  // Validation errors (Req 16.4)
  // -------------------------------------------------------------------------

  /**
   * Sent when the task name input exceeds 200 characters.
   * Req 16.4
   */
  TASK_NAME_TOO_LONG:
    '⚠️ Назва задачі занадто довга.\n' +
    'Будь ласка, введіть назву до 200 символів.',

  /**
   * Sent when a file attachment exceeds the 20 MB size limit.
   * Req 7.6
   */
  FILE_TOO_LARGE:
    '❌ Файл перевищує 20 МБ.\n' +
    'Будь ласка, надішліть менший файл.',

  // -------------------------------------------------------------------------
  // Infrastructure / technical errors (Req 16.1, 16.2)
  // -------------------------------------------------------------------------

  /**
   * Sent when a Supabase / PostgreSQL database operation fails.
   * Req 16.1
   */
  DB_ERROR:
    '⚠️ Виникла технічна помилка при роботі з базою даних.\n' +
    'Будь ласка, спробуйте пізніше.',

  /**
   * Sent when a Telegram Bot API call fails after the retry attempt.
   * Req 16.2
   */
  TELEGRAM_API_ERROR:
    '⚠️ Виникла помилка при відправці повідомлення.\n' +
    'Будь ласка, спробуйте ще раз.',

  /**
   * Sent when a Supabase Storage operation (file upload/download) fails.
   */
  STORAGE_ERROR:
    '⚠️ Виникла помилка при збереженні файлу.\n' +
    'Будь ласка, спробуйте ще раз.',

  // -------------------------------------------------------------------------
  // Session management (Req 12.3, 12.4)
  // -------------------------------------------------------------------------

  /**
   * Sent when the user's session is reset (expired or /cancel command).
   * Req 12.3, 12.4
   */
  SESSION_RESET:
    '🔄 Сесію скинуто. Повертаємось до головного меню.',

  // -------------------------------------------------------------------------
  // Admin / user management
  // -------------------------------------------------------------------------

  MANAGE_USERS_PROMPT: '🔑 Управління користувачами. Оберіть дію:',

  ADD_ADMIN_PROMPT:
    '➕ *Додати адміна*\n\n' +
    'Перешліть будь-яке повідомлення від потрібної людини\n' +
    'або введіть їх @username чи числовий ID.',

  ADD_EMPLOYEE_PROMPT:
    '➕ *Додати співробітника*\n\n' +
    'Перешліть будь-яке повідомлення від потрібної людини\n' +
    'або введіть їх @username чи числовий ID.',

  USER_ADDED_ADMIN: (telegramId: number): string =>
    `✅ Користувача з ID *${telegramId}* додано як адміна.`,

  USER_ADDED_EMPLOYEE: (telegramId: number): string =>
    `✅ Користувача з ID *${telegramId}* додано як співробітника.`,

  USER_ALREADY_EXISTS:
    '⚠️ Користувач із таким Telegram ID вже зареєстрований у системі.',

  INVALID_TELEGRAM_ID:
    '⚠️ Невірний формат. Введіть числовий Telegram ID (наприклад: 123456789).',

  NO_ADMINS_TO_REMOVE: '⚠️ Немає адмінів для видалення (крім вас).',

  ADMIN_REMOVED: (name: string): string =>
    `✅ Адміна *${name}* видалено з системи.`,

  CANNOT_REMOVE_SELF: '⚠️ Ви не можете видалити самого себе.',
} as const;

// ---------------------------------------------------------------------------
// Type helpers
// ---------------------------------------------------------------------------

/**
 * Union of all MESSAGES keys — useful for type-safe lookups.
 */
export type MessageKey = keyof typeof MESSAGES;
