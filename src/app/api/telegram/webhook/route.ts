/**
 * Telegram webhook handler — Next.js App Router API route.
 *
 * Responsibilities:
 *  - Validate the X-Telegram-Bot-Api-Secret-Token header (Req 13.1)
 *  - Parse the incoming JSON update (Req 13.2)
 *  - Respond HTTP 200 immediately to satisfy Telegram's 5-second window (Req 13.3)
 *  - Process the update asynchronously via processUpdate (Req 13.4, 13.5)
 *  - Handle unregistered users, expired sessions, /cancel, and /start (Req 16.5)
 *
 * Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 16.5
 */

import * as telegramClient from '@/lib/telegram/client';
import * as router from '@/lib/handlers/router';
import { sessionService } from '@/lib/services/session.service';
import { userService } from '@/lib/services/user.service';
import { MESSAGES } from '@/lib/messages';
import { logger } from '@/lib/utils/logger';
import { EMPLOYEE_MAIN_MENU, ADMIN_MAIN_MENU } from '@/lib/telegram/keyboards';
import type { TelegramUpdate, HandlerContext } from '@/types/index';

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------

/**
 * Handles incoming Telegram webhook POST requests.
 *
 * 1. Validates the secret token header — returns 401 on mismatch (Req 13.1).
 * 2. Parses the JSON body — returns 200 (to avoid Telegram retries) on invalid JSON (Req 13.2).
 * 3. Responds 200 immediately, then processes the update asynchronously (Req 13.3).
 */
export async function POST(request: Request): Promise<Response> {
  // Step 1: Validate secret token (Req 13.1)
  const secretToken = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
  if (secretToken !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return new Response('Unauthorized', { status: 401 });
  }

  // Step 2: Parse request body (Req 13.2)
  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    logger.error('Invalid JSON in webhook request');
    return new Response('OK', { status: 200 }); // Avoid Telegram retries
  }

  // Step 3: Respond immediately; process asynchronously (Req 13.3)
  processUpdate(update).catch((err: unknown) => {
    logger.error('Unhandled error in processUpdate', err);
  });

  return new Response('OK', { status: 200 });
}

// ---------------------------------------------------------------------------
// Async update processor
// ---------------------------------------------------------------------------

/**
 * Processes a single Telegram update after the HTTP 200 has been sent.
 *
 * Flow:
 *  1. Extract telegramId and chatId from the update.
 *  2. Look up the user — send NOT_REGISTERED message if unknown (Req 16.5).
 *  3. Load the session; reset it if expired (Req 13.4).
 *  4. Handle /cancel — reset session and show main menu (Req 13.5).
 *  5. Handle /start — show role-appropriate main menu.
 *  6. Delegate everything else to the router (Req 13.5).
 */
async function processUpdate(update: TelegramUpdate): Promise<void> {
  const telegramId =
    update.message?.from.id ?? update.callback_query?.from.id;
  const chatId =
    update.message?.chat.id ?? update.callback_query?.message?.chat.id;

  if (!telegramId || !chatId) {
    return;
  }

  // Step 2: Load user (Req 16.5)
  const user = await userService.findByTelegramId(telegramId);

  if (!user) {
    await telegramClient.sendMessage(chatId, MESSAGES.NOT_REGISTERED);
    return;
  }

  // Step 3: Load and check session expiry (Req 13.4)
  let session = await sessionService.getSession(user.id);
  if (sessionService.isExpired(session)) {
    await sessionService.resetSession(user.id);
    session = await sessionService.getSession(user.id);
  }

  // Step 4: Handle /cancel (Req 13.5)
  if (update.message?.text === '/cancel') {
    await sessionService.resetSession(user.id);
    await telegramClient.sendMessage(chatId, MESSAGES.SESSION_RESET);
    await showMainMenu(chatId, user.role);
    return;
  }

  // Step 5: Handle /start — show role-appropriate main menu
  if (update.message?.text === '/start') {
    await showMainMenu(chatId, user.role);
    return;
  }

  // Step 6: Delegate to router (Req 13.5)
  const context: HandlerContext = { user, session, telegramId, chatId };
  await router.route(update, context);
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/**
 * Sends the role-appropriate main menu keyboard to the given chat.
 */
async function showMainMenu(
  chatId: number,
  role: 'admin' | 'employee',
): Promise<void> {
  if (role === 'admin') {
    await telegramClient.sendMessage(chatId, MESSAGES.MAIN_MENU_ADMIN, {
      reply_markup: ADMIN_MAIN_MENU,
    });
  } else {
    await telegramClient.sendMessage(chatId, MESSAGES.MAIN_MENU_EMPLOYEE, {
      reply_markup: EMPLOYEE_MAIN_MENU,
    });
  }
}
