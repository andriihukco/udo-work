/**
 * Telegram inline keyboard type definitions.
 * Used by the Telegram Bot API for interactive message buttons.
 * Requirements: 3.1, 6.3
 */

/** A single button in an inline keyboard row. */
export interface InlineKeyboardButton {
  /** Label text displayed on the button. */
  text: string;
  /** Data sent in a callback_query when the button is pressed. */
  callback_data?: string;
  /** HTTP URL to open when the button is pressed. */
  url?: string;
}

/**
 * A 2-D array of InlineKeyboardButton representing the full keyboard layout.
 * Each inner array is a row of buttons displayed horizontally.
 */
export type InlineKeyboard = InlineKeyboardButton[][];

/**
 * The reply_markup object accepted by Telegram's sendMessage /
 * editMessageReplyMarkup API methods.
 */
export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboard;
}
