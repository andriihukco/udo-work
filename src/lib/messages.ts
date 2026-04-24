/**
 * Ukrainian message constants for the Telegram Time Tracker bot.
 */

import { formatDateTime, formatTimeSpent } from './utils/time';
import type { TimeSpent } from '../types/index';

export const MESSAGES = {
  // ── Access / Registration ─────────────────────────────────────────────────

  NOT_REGISTERED:
    '👋 *Вітаємо!*\n\n' +
    'Вас ще не зареєстровано в системі.\n' +
    'Зверніться до адміністратора для отримання доступу.',

  NO_PERMISSION: '🚫 *Доступ заборонено*\n\nУ вас немає прав для виконання цієї дії.',

  // ── Welcome / Main menus ──────────────────────────────────────────────────

  WELCOME: '👋 *Вітаємо!* Оберіть дію з меню нижче.',
  MAIN_MENU_EMPLOYEE: '📋 *Головне меню*\nОберіть дію:',
  MAIN_MENU_ADMIN: '⚙️ *Панель адміністратора*\nОберіть дію:',

  // ── Project management ────────────────────────────────────────────────────

  NO_ACTIVE_PROJECTS:
    '📭 *Немає активних проєктів*\n\n' +
    'Зверніться до адміністратора для створення проєкту.',

  DUPLICATE_PROJECT:
    '⚠️ *Назва вже зайнята*\n\n' +
    'Проєкт із такою назвою вже існує.\n' +
    'Будь ласка, введіть іншу назву.',

  PROJECT_CREATED: (name: string) => `✅ *Проєкт створено!*\n\n📁 ${name}`,
  PROJECT_DEACTIVATED: (name: string) => `🔴 *Проєкт деактивовано*\n\n📁 ${name}`,
  PROJECT_ACTIVATED: (name: string) => `🟢 *Проєкт активовано*\n\n📁 ${name}`,

  // ── Task lifecycle ────────────────────────────────────────────────────────

  TASK_STARTED: (taskName: string, projectName: string, startedAt: Date | string) =>
    `🚀 *Задачу розпочато!*\n\n` +
    `📌 *Задача:* ${taskName}\n` +
    `📁 *Проєкт:* ${projectName}\n` +
    `🕐 *Початок:* ${formatDateTime(startedAt)}\n\n` +
    `_Час пішов! Натисніть ⏸️ Пауза коли потрібно._`,

  ACTIVE_TASK_EXISTS:
    '⚠️ *Задача вже активна*\n\n' +
    'У вас вже є задача в роботі.\n' +
    'Спочатку поставте її на паузу або завершіть.',

  TASK_PAUSED: (taskName: string, pausedAt: Date | string) =>
    `⏸️ *Задачу поставлено на паузу*\n\n` +
    `📌 *Задача:* ${taskName}\n` +
    `🕐 *Час паузи:* ${formatDateTime(pausedAt)}\n\n` +
    `_Натисніть ▶️ Відновити щоб продовжити._`,

  NO_ACTIVE_TASK: '❌ *Немає активної задачі*\n\nНемає задачі для паузи або завершення.',

  TASK_RESUMED: (taskName: string, resumedAt: Date | string) =>
    `▶️ *Задачу відновлено!*\n\n` +
    `📌 *Задача:* ${taskName}\n` +
    `🕐 *Відновлено:* ${formatDateTime(resumedAt)}\n\n` +
    `_Продовжуємо відлік часу._`,

  NO_PAUSED_TASK: '❌ *Немає задачі на паузі*\n\nНемає задачі для відновлення.',

  TASK_COMPLETED: (taskName: string, totalTime: TimeSpent) =>
    `✅ *Задачу завершено!*\n\n` +
    `📌 *Задача:* ${taskName}\n` +
    `⏱️ *Витрачено:* ${formatTimeSpent(totalTime)}\n\n` +
    `_Чудова робота! 🎉_`,

  // ── Deliverables ──────────────────────────────────────────────────────────

  ATTACH_DELIVERABLE_PROMPT:
    '📎 *Прикріпити результати?*\n\n' +
    'Надішліть файл, фото або текстовий опис.\n' +
    'Або оберіть дію нижче.',

  DELIVERABLE_SAVED:
    '✅ *Результат збережено!*\n\n' +
    'Бажаєте додати ще один результат?',

  // ── Activity ──────────────────────────────────────────────────────────────

  NO_ACTIVITY: '📭 *Немає активності*\n\nЗа обраний період задач не знайдено.',

  // ── Validation ────────────────────────────────────────────────────────────

  TASK_NAME_TOO_LONG:
    '⚠️ *Назва задачі занадто довга*\n\n' +
    'Будь ласка, введіть назву до 200 символів.',

  FILE_TOO_LARGE:
    '❌ *Файл занадто великий*\n\n' +
    'Максимальний розмір — 20 МБ.\n' +
    'Стисніть файл або надішліть менший.',

  // ── Errors — specific and actionable ─────────────────────────────────────

  /** Generic fallback — should rarely appear after smart error routing */
  DB_ERROR:
    '⚠️ *Тимчасова помилка*\n\n' +
    'Не вдалося виконати дію. Спробуйте ще раз через кілька секунд.\n\n' +
    '_Якщо помилка повторюється — зверніться до адміністратора._',

  /** Notification send failed — non-critical, task was saved */
  NOTIFICATION_ERROR:
    '⚠️ *Сповіщення не надіслано*\n\n' +
    'Задачу збережено, але не вдалося сповістити адміністратора.\n' +
    'Це не впливає на облік часу.',

  /** File upload to storage failed */
  STORAGE_ERROR:
    '❌ *Не вдалося завантажити файл*\n\n' +
    'Можливі причини:\n' +
    '• Файл пошкоджений або недоступний\n' +
    '• Тимчасова проблема з сервером\n\n' +
    'Спробуйте надіслати файл ще раз або пропустіть цей крок.',

  /** Telegram API error */
  TELEGRAM_API_ERROR:
    '⚠️ *Помилка відправки*\n\n' +
    'Виникла помилка при відправці повідомлення.\n' +
    'Будь ласка, спробуйте ще раз.',

  /** Session expired or lost context */
  SESSION_RESET:
    '🔄 *Сесію скинуто*\n\nПовертаємось до головного меню.',

  // ── Admin / user management ───────────────────────────────────────────────

  MANAGE_USERS_PROMPT: '🔑 *Управління користувачами*\nОберіть дію:',

  ADD_ADMIN_PROMPT:
    '➕ *Додати адміна*\n\n' +
    'Перешліть будь-яке повідомлення від потрібної людини,\n' +
    'або введіть їх @username чи числовий ID.',

  ADD_EMPLOYEE_PROMPT:
    '➕ *Додати співробітника*\n\n' +
    'Перешліть будь-яке повідомлення від потрібної людини,\n' +
    'або введіть їх @username чи числовий ID.',

  USER_ADDED_ADMIN: (telegramId: number) => `✅ *Адміна додано!*\n\n🆔 \`${telegramId}\``,
  USER_ADDED_EMPLOYEE: (telegramId: number) => `✅ *Співробітника додано!*\n\n🆔 \`${telegramId}\``,

  USER_ALREADY_EXISTS:
    '⚠️ *Вже зареєстрований*\n\n' +
    'Користувач із таким Telegram ID вже є в системі.',

  INVALID_TELEGRAM_ID:
    '⚠️ *Невірний формат*\n\n' +
    'Введіть числовий Telegram ID (наприклад: `123456789`).',

  NO_ADMINS_TO_REMOVE: '⚠️ *Немає адмінів для видалення* (крім вас).',
  ADMIN_REMOVED: (name: string) => `✅ *Адміна видалено*\n\n👤 ${name}`,
  CANNOT_REMOVE_SELF: '⚠️ *Неможливо видалити себе.*',
} as const;

export type MessageKey = keyof typeof MESSAGES;
