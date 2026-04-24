/**
 * Classifies an unknown error into a user-friendly Ukrainian message.
 * Used by both admin and employee handlers to replace the generic DB_ERROR.
 */

import {
  DatabaseError,
  StorageError,
  FileTooLargeError,
  TelegramApiError,
  ActiveTaskExistsError,
  NoActiveTaskError,
  NoPausedTaskError,
  ValidationError,
  DuplicateProjectError,
} from '@/types/index';

export function classifyError(err: unknown): string {
  // ── Known domain errors ───────────────────────────────────────────────────

  if (err instanceof FileTooLargeError) {
    return (
      '❌ *Файл занадто великий*\n\n' +
      'Максимальний розмір — 20 МБ.\n' +
      'Стисніть файл або надішліть менший.'
    );
  }

  if (err instanceof DuplicateProjectError) {
    return (
      '⚠️ *Назва вже зайнята*\n\n' +
      'Проєкт із такою назвою вже існує.\n' +
      'Введіть іншу назву.'
    );
  }

  if (err instanceof ActiveTaskExistsError) {
    return (
      '⚠️ *Задача вже активна*\n\n' +
      'У вас вже є задача в роботі.\n' +
      'Спочатку поставте її на паузу або завершіть.'
    );
  }

  if (err instanceof NoActiveTaskError) {
    return '❌ *Немає активної задачі*\n\nНемає задачі для цієї дії.';
  }

  if (err instanceof NoPausedTaskError) {
    return '❌ *Немає задачі на паузі*\n\nНемає задачі для відновлення.';
  }

  if (err instanceof ValidationError) {
    return (
      '⚠️ *Невірні дані*\n\n' +
      'Перевірте введені дані та спробуйте ще раз.'
    );
  }

  if (err instanceof StorageError) {
    return (
      '❌ *Не вдалося завантажити файл*\n\n' +
      'Можливі причини:\n' +
      '• Файл пошкоджений або недоступний\n' +
      '• Тимчасова проблема з сервером\n\n' +
      'Спробуйте надіслати файл ще раз або пропустіть цей крок (_/skip_).'
    );
  }

  if (err instanceof TelegramApiError) {
    return (
      '⚠️ *Помилка Telegram*\n\n' +
      'Не вдалося відправити повідомлення.\n' +
      'Спробуйте ще раз або перезапустіть бот командою /start.'
    );
  }

  if (err instanceof DatabaseError) {
    // Try to give a hint from the error message
    const msg = (err as Error).message ?? '';

    if (msg.includes('invite') || msg.includes('token')) {
      return (
        '⚠️ *Не вдалося створити запрошення*\n\n' +
        'Перевірте, що проєкт існує та активний.\n' +
        'Спробуйте ще раз або оберіть інший проєкт.'
      );
    }

    if (msg.includes('project')) {
      return (
        '⚠️ *Помилка проєкту*\n\n' +
        'Не вдалося виконати дію з проєктом.\n' +
        'Спробуйте ще раз або оберіть інший проєкт.'
      );
    }

    if (msg.includes('user') || msg.includes('member')) {
      return (
        '⚠️ *Помилка користувача*\n\n' +
        'Не вдалося виконати дію з користувачем.\n' +
        'Перевірте дані та спробуйте ще раз.'
      );
    }

    if (msg.includes('task')) {
      return (
        '⚠️ *Помилка задачі*\n\n' +
        'Не вдалося виконати дію із задачею.\n' +
        'Спробуйте ще раз або поверніться до головного меню (/start).'
      );
    }

    if (msg.includes('attachment') || msg.includes('storage')) {
      return (
        '⚠️ *Помилка збереження*\n\n' +
        'Не вдалося зберегти вкладення.\n' +
        'Спробуйте ще раз або пропустіть цей крок (_/skip_).'
      );
    }

    // Generic DB error with retry hint
    return (
      '⚠️ *Тимчасова помилка бази даних*\n\n' +
      'Не вдалося виконати запит. Зазвичай це минає за кілька секунд.\n\n' +
      '• Спробуйте ще раз\n' +
      '• Або поверніться до меню: /start\n\n' +
      '_Якщо помилка повторюється — зверніться до адміністратора._'
    );
  }

  // ── Network / fetch errors ────────────────────────────────────────────────

  const errMsg = err instanceof Error ? err.message : String(err);

  if (errMsg.includes('fetch') || errMsg.includes('network') || errMsg.includes('ECONNREFUSED') || errMsg.includes('timeout')) {
    return (
      '🌐 *Помилка мережі*\n\n' +
      'Не вдалося підключитися до сервера.\n' +
      'Перевірте з\'єднання та спробуйте ще раз.'
    );
  }

  if (errMsg.includes('timeout') || errMsg.includes('ETIMEDOUT')) {
    return (
      '⏱ *Час очікування вичерпано*\n\n' +
      'Сервер не відповів вчасно.\n' +
      'Спробуйте ще раз через кілька секунд.'
    );
  }

  // ── Unknown fallback ──────────────────────────────────────────────────────

  return (
    '⚠️ *Щось пішло не так*\n\n' +
    'Виникла непередбачена помилка.\n\n' +
    '• Спробуйте ще раз\n' +
    '• Або поверніться до меню: /start\n\n' +
    '_Якщо помилка повторюється — зверніться до адміністратора._'
  );
}
