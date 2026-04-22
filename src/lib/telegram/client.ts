/**
 * Telegram Bot API wrapper.
 * Provides typed methods for the Bot API calls used by this application.
 * Applies one-retry logic (1 s delay) for non-notification API errors.
 * Requirements: 13.2, 16.2
 */

import { TelegramApiError } from '@/types';
import { logger } from '@/lib/utils/logger';
import type { InlineKeyboardMarkup, ReplyMarkup } from './types';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function getBotToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN environment variable is not set');
  }
  return token;
}

function apiUrl(method: string): string {
  return `https://api.telegram.org/bot${getBotToken()}/${method}`;
}

function cdnUrl(filePath: string): string {
  return `https://api.telegram.org/file/bot${getBotToken()}/${filePath}`;
}

/** Pause execution for the given number of milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Executes a Telegram API call. On failure, retries once after 1 second
 * (unless `skipRetry` is true — used for notification fan-out where errors
 * are silently logged per Requirement 11.4 / 16.2).
 */
async function callApi<T>(
  method: string,
  body: Record<string, unknown>,
  skipRetry = false,
): Promise<T> {
  const attempt = async (): Promise<T> => {
    const response = await fetch(apiUrl(method), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText);
      throw new TelegramApiError(
        `Telegram API ${method} failed (${response.status}): ${text}`,
      );
    }

    const json = (await response.json()) as { ok: boolean; result: T; description?: string };

    if (!json.ok) {
      throw new TelegramApiError(
        `Telegram API ${method} returned ok=false: ${json.description ?? 'unknown error'}`,
      );
    }

    return json.result;
  };

  try {
    return await attempt();
  } catch (err) {
    if (skipRetry) {
      throw err;
    }
    // Requirement 16.2: retry once after 1 second
    logger.warn(`Telegram API call ${method} failed, retrying in 1 s…`, err);
    await sleep(1000);
    return attempt();
  }
}

// ---------------------------------------------------------------------------
// Telegram API response shapes (minimal — only fields we use)
// ---------------------------------------------------------------------------

interface TelegramMessageResult {
  message_id: number;
  chat: { id: number };
}

interface TelegramFileResult {
  file_id: string;
  file_path?: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface SendMessageOptions {
  reply_markup?: ReplyMarkup;
  parse_mode?: 'Markdown' | 'MarkdownV2' | 'HTML';
  disable_web_page_preview?: boolean;
}

/**
 * Sends a text message to a Telegram chat.
 * Retries once on failure (Requirement 16.2).
 */
export async function sendMessage(
  chatId: number,
  text: string,
  options: SendMessageOptions = {},
): Promise<TelegramMessageResult> {
  return callApi<TelegramMessageResult>('sendMessage', {
    chat_id: chatId,
    text,
    ...options,
  });
}

/**
 * Replaces the inline keyboard of an existing message.
 * Retries once on failure (Requirement 16.2).
 */
export async function editMessageReplyMarkup(
  chatId: number,
  messageId: number,
  replyMarkup: InlineKeyboardMarkup,
): Promise<void> {
  await callApi<unknown>('editMessageReplyMarkup', {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: replyMarkup,
  });
}

/**
 * Edits the text (and optionally the keyboard) of an existing message.
 * Used to update the current message in place instead of sending a new one.
 * Retries once on failure (Requirement 16.2).
 */
export async function editMessageText(
  chatId: number,
  messageId: number,
  text: string,
  options: SendMessageOptions = {},
): Promise<void> {
  await callApi<unknown>('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    ...options,
  });
}

/**
 * Answers a callback query to dismiss the loading indicator on the button.
 * Retries once on failure (Requirement 16.2).
 */
export async function answerCallbackQuery(
  callbackQueryId: string,
  text?: string,
): Promise<void> {
  await callApi<unknown>('answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    ...(text !== undefined ? { text } : {}),
  });
}

/**
 * Retrieves file metadata from Telegram, returning the `file_path` needed
 * to download the file from the CDN.
 * Retries once on failure (Requirement 16.2).
 */
export async function getFile(fileId: string): Promise<TelegramFileResult> {
  return callApi<TelegramFileResult>('getFile', { file_id: fileId });
}

/**
 * Downloads raw file bytes from the Telegram CDN using a `file_path`
 * obtained from `getFile`.
 * Retries once on failure (Requirement 16.2).
 */
export async function downloadFile(filePath: string): Promise<Buffer> {
  const url = cdnUrl(filePath);

  const attempt = async (): Promise<Buffer> => {
    const response = await fetch(url);
    if (!response.ok) {
      throw new TelegramApiError(
        `Failed to download file from Telegram CDN (${response.status}): ${response.statusText}`,
      );
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  };

  try {
    return await attempt();
  } catch (err) {
    logger.warn('Telegram file download failed, retrying in 1 s…', err);
    await sleep(1000);
    return attempt();
  }
}

/**
 * Sends a notification message to a chat.
 * Errors are NOT retried — callers (NotificationService) catch and log them
 * individually per Requirement 11.4.
 */
export async function sendNotification(
  chatId: number,
  text: string,
  options: SendMessageOptions = {},
): Promise<TelegramMessageResult> {
  return callApi<TelegramMessageResult>(
    'sendMessage',
    { chat_id: chatId, text, ...options },
    /* skipRetry */ true,
  );
}

/**
 * Sends a chat action (e.g. "typing") to show the bot is working.
 * Errors are silently ignored — this is purely cosmetic.
 */
export async function sendChatAction(
  chatId: number,
  action: 'typing' | 'upload_document' | 'upload_photo' = 'typing',
): Promise<void> {
  await callApi<unknown>('sendChatAction', { chat_id: chatId, action }, /* skipRetry */ true).catch(() => {});
}
