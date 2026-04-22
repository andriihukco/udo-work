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
import { membershipService } from '@/lib/services/membership.service';
import { MESSAGES } from '@/lib/messages';
import { logger } from '@/lib/utils/logger';
import { EMPLOYEE_MAIN_MENU, ADMIN_MAIN_MENU, EMPLOYEE_REPLY_KEYBOARD, ADMIN_REPLY_KEYBOARD, buildAdminMainMenu } from '@/lib/telegram/keyboards';
import type { TelegramUpdate, HandlerContext, User } from '@/types/index';

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

  // Step 3: Process the update, then respond.
  // Note: On Vercel serverless, fire-and-forget after Response is not reliable
  // because the function terminates immediately after returning. We await here
  // and rely on the function's maxDuration (10s) to stay within Telegram's window.
  try {
    await processUpdate(update);
  } catch (err: unknown) {
    logger.error('Unhandled error in processUpdate', err);
  }

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

  // /skip is handled inside the router state machine — don't intercept here

  // Step 5: Handle /start — show role-appropriate main menu, or redeem invite
  if (update.message?.text?.startsWith('/start')) {
    const param = update.message.text.slice('/start'.length).trim();

    if (param.startsWith('invite_')) {
      const token = param.slice('invite_'.length);
      await handleInviteRedeem(chatId, user, token);
      return;
    }

    await showMainMenu(chatId, user.role, telegramId);
    return;
  }

  // Step 6: Delegate to router (Req 13.5)
  const context: HandlerContext = { user, session, telegramId, chatId };

  // Show typing indicator before processing (cosmetic, fire-and-forget)
  telegramClient.sendChatAction(chatId, 'typing').catch(() => {});

  await router.route(update, context);
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/**
 * Sends the role-appropriate main menu keyboard to the given chat.
 * Sends the reply keyboard first (persists in the input area), then the
 * inline menu message so both are visible.
 */
async function showMainMenu(
  chatId: number,
  role: 'admin' | 'employee',
  telegramId?: number,
): Promise<void> {
  if (role === 'admin') {
    const adminMenu = telegramId ? buildAdminMainMenu(telegramId) : ADMIN_MAIN_MENU;
    await telegramClient.sendMessage(chatId, MESSAGES.MAIN_MENU_ADMIN, {
      reply_markup: ADMIN_REPLY_KEYBOARD,
    });
    await telegramClient.sendMessage(chatId, '⚙️ Або оберіть дію з меню нижче:', {
      reply_markup: adminMenu,
    });
  } else {
    await telegramClient.sendMessage(chatId, MESSAGES.MAIN_MENU_EMPLOYEE, {
      reply_markup: EMPLOYEE_REPLY_KEYBOARD,
    });
    await telegramClient.sendMessage(chatId, '📋 Або оберіть дію з меню нижче:', {
      reply_markup: EMPLOYEE_MAIN_MENU,
    });
  }
}

/**
 * Handles invite token redemption from a /start?invite_xxx deep link.
 */
async function handleInviteRedeem(chatId: number, user: User, token: string): Promise<void> {
  try {
    const result = await membershipService.redeemToken(token, user.id);

    if (!result) {
      await telegramClient.sendMessage(
        chatId,
        '⚠️ Посилання-запрошення недійсне або вже використане.\nЗверніться до адміністратора за новим посиланням.',
      );
      await showMainMenu(chatId, user.role);
      return;
    }

    const { project, role } = result;

    // If role changed, update the user's role
    if (user.role !== role) {
      await userService.updateRole(user.id, role);
    }

    // Add to project members
    await membershipService.addMember(project.id, user.id);

    const roleLabel = role === 'admin' ? 'адміна' : 'співробітника';
    await telegramClient.sendMessage(
      chatId,
      `✅ Вас додано до проєкту *${project.name}* як *${roleLabel}*!`,
      { parse_mode: 'Markdown' },
    );
    await showMainMenu(chatId, role, user.telegram_id);
  } catch (err) {
    logger.error('handleInviteRedeem failed', err);
    await telegramClient.sendMessage(chatId, MESSAGES.DB_ERROR);
    await showMainMenu(chatId, user.role);
  }
}
