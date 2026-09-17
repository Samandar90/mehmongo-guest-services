import type { OfferSnapshot } from './catalog.ts';
import type { GuestLocale, ServiceId } from './contracts.ts';

const TELEGRAM_PARSE_MODE = 'HTML';
const TELEGRAM_TIMEOUT_MS = 8_000;

export type TelegramRequest = {
  reference: string;
  hotelName: string;
  roomLabel: string;
  service: ServiceId;
  choice: string;
  pickup: string;
  destination: string;
  requestedDate: string | null;
  requestedTime: string | null;
  partySize: number | null;
  guestName: string;
  contact: string;
  note: string;
  /** Snapshot stored with the request; retries reuse it instead of today's catalogue. */
  offer?: OfferSnapshot | null;
  /** The language the guest was reading; the team answers in it. Absent means English. */
  guestLocale?: GuestLocale | null;
  /** The guest asked for the nearest possible time; requestedTime is then null. */
  asap?: boolean;
};

/** In Russian, for the team: the language to call the guest back in. */
export function guestLanguageLabel(locale: GuestLocale | null | undefined): string {
  return {
    en: 'английский',
    ru: 'русский',
    uz: 'узбекский',
    zh: 'китайский',
  }[locale ?? 'en'];
}

export type TelegramFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export class TelegramDeliveryError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    /** Set only when Telegram says the group became a supergroup: the id to use from now on. */
    public readonly migrateToChatId: number | null = null,
  ) {
    super(message);
    this.name = 'TelegramDeliveryError';
  }
}

/**
 * Why Telegram refused a message, as a code the owner can act on.
 *
 * Until 2026-09-17 every refusal was stored as TELEGRAM_API_ERROR, and when the
 * group stopped receiving requests nobody could tell whether the bot had been
 * removed, the group upgraded, or the token revoked. Only the HTTP status, a few
 * fixed phrases of Telegram's description and the numeric migrate_to_chat_id
 * are read here. None of Telegram's text is kept: a description can echo what
 * was sent, and what was sent is a guest's name and phone number.
 */
export function classifyTelegramRefusal(status: number, payload: unknown): TelegramDeliveryError {
  const body = payload && typeof payload === 'object' ? payload as { description?: unknown; parameters?: { migrate_to_chat_id?: unknown } } : {};
  const description = typeof body.description === 'string' ? body.description.toLowerCase() : '';
  const migrateTo = body.parameters?.migrate_to_chat_id;

  if (typeof migrateTo === 'number' && Number.isSafeInteger(migrateTo)) {
    return new TelegramDeliveryError('TELEGRAM_CHAT_MIGRATED', 'The group was upgraded to a supergroup', migrateTo);
  }
  if (status === 401) return new TelegramDeliveryError('TELEGRAM_BOT_TOKEN_INVALID', 'Telegram rejected the bot token');
  // 403 is "bot was kicked from the group chat" or "bot is not a member": either way it cannot post.
  if (status === 403) return new TelegramDeliveryError('TELEGRAM_BOT_REMOVED', 'The bot cannot write to the group');
  if (status === 429) return new TelegramDeliveryError('TELEGRAM_RATE_LIMITED', 'Telegram is rate limiting the bot');
  if (description.includes('chat not found')) return new TelegramDeliveryError('TELEGRAM_CHAT_NOT_FOUND', 'Telegram cannot find the group');
  if (description.includes('not enough rights') || description.includes('have no rights')) {
    return new TelegramDeliveryError('TELEGRAM_BOT_NO_RIGHTS', 'The bot has no right to post in the group');
  }
  if (description.includes("can't parse entities")) return new TelegramDeliveryError('TELEGRAM_MESSAGE_REJECTED', 'Telegram could not parse the message');
  return new TelegramDeliveryError('TELEGRAM_API_ERROR', 'Telegram API request failed');
}

/** The fixed wording stored for each code; a message raised anywhere else is never persisted. */
const deliveryFailureMessages: Record<string, string> = {
  TELEGRAM_TIMEOUT: 'Telegram request timed out',
  TELEGRAM_NETWORK_ERROR: 'Telegram network request failed',
  TELEGRAM_API_ERROR: 'Telegram API request failed',
  TELEGRAM_RESPONSE_INVALID: 'Telegram response was invalid',
  TELEGRAM_BOT_TOKEN_INVALID: 'Telegram rejected the bot token',
  TELEGRAM_BOT_REMOVED: 'The bot cannot write to the group',
  TELEGRAM_CHAT_MIGRATED: 'The group was upgraded to a supergroup',
  TELEGRAM_CHAT_NOT_FOUND: 'Telegram cannot find the group',
  TELEGRAM_BOT_NO_RIGHTS: 'The bot has no right to post in the group',
  TELEGRAM_RATE_LIMITED: 'Telegram is rate limiting the bot',
  TELEGRAM_MESSAGE_REJECTED: 'Telegram could not parse the message',
};

/**
 * What a failed delivery row records. Shared by submit-request and
 * retry-telegram, which each kept their own copy of this before.
 */
export function deliveryFailureRecord(reason: unknown): { code: string; message: string } {
  if (reason instanceof TelegramDeliveryError && Object.hasOwn(deliveryFailureMessages, reason.code)) {
    const message = deliveryFailureMessages[reason.code];
    // The new group id is the one thing worth keeping from a refusal: it is
    // what has to go into TELEGRAM_CHAT_ID, and it is a number we checked.
    const migrated = reason.code === 'TELEGRAM_CHAT_MIGRATED' && reason.migrateToChatId !== null && Number.isSafeInteger(reason.migrateToChatId);
    return { code: reason.code, message: migrated ? `${message}; new chat id ${reason.migrateToChatId}` : message };
  }
  return { code: 'TELEGRAM_DELIVERY_FAILED', message: 'Telegram delivery failed' };
}

function escapeHtml(value: string | number): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function serviceLabel(service: ServiceId): string {
  return {
    tours: 'Экскурсия',
    transport: 'Транспорт',
    restaurants: 'Ресторан',
    tickets: 'Билеты',
  }[service];
}

function formatDate(value: string | null, timeZone: string): string | null {
  if (!value) return null;
  const date = new Date(`${value}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return escapeHtml(value);
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long', timeZone }).format(date);
}

/**
 * The starting price the guest saw, never a confirmed total. Built from the
 * stored snapshot so a later catalogue change cannot rewrite an old message.
 */
export function formatOfferEstimate(offer: OfferSnapshot): string {
  if (offer.priceMode === 'quote') {
    return offer.capacityExceeded
      ? 'индивидуальный расчёт (группа больше опубликованной вместимости)'
      : 'индивидуальный расчёт';
  }
  const amount = offer.amount === null ? '' : `от ${offer.amount}${offer.currency ? ` ${offer.currency}` : ''}`;
  const unit = offer.unit ? ` (${offer.unit})` : '';
  return `${amount}${unit}. Цена не подтверждена`;
}

export function formatTelegramRequest(request: TelegramRequest, timeZone: string): string {
  const lines = [
    `<b>🆕 Новая заявка ${escapeHtml(request.reference)}${request.asap ? ' ⚡ срочно' : ''}</b>`,
    `🏨 Отель: ${escapeHtml(request.hotelName)}`,
    `🚪 Комната: ${escapeHtml(request.roomLabel)}`,
    `🧭 Услуга: ${serviceLabel(request.service)}`,
  ];

  if (request.offer) {
    lines.push(`🧾 Предложение: ${escapeHtml(request.offer.title)}`);
    lines.push(`💵 Ориентир: ${escapeHtml(formatOfferEstimate(request.offer))}`);
  }

  // Catalogue profiles fill only the columns they use, so each line is printed
  // when it carries a value instead of being assumed from the category.
  if (request.pickup) lines.push(`📍 Откуда: ${escapeHtml(request.pickup)}`);
  if (request.destination) lines.push(`➡️ Куда: ${escapeHtml(request.destination)}`);
  if (request.choice) lines.push(`🔎 Выбор: ${escapeHtml(request.choice)}`);

  const date = formatDate(request.requestedDate, timeZone);
  if (date) lines.push(`📅 Дата: ${escapeHtml(date)}`);
  if (request.asap) lines.push('🕒 Время: ⚡ как можно скорее');
  else if (request.requestedTime) lines.push(`🕒 Время: ${escapeHtml(request.requestedTime)}`);
  if (request.partySize !== null) lines.push(`👥 Гостей: ${escapeHtml(request.partySize)}`);
  lines.push(`👤 Гость: ${escapeHtml(request.guestName)}`);
  lines.push(`📞 Контакт: ${escapeHtml(request.contact)}`);
  // Printed for every request, so a guest who read the site in Chinese is
  // called back in Chinese and not in the language the team assumed.
  lines.push(`🌐 Язык гостя: ${guestLanguageLabel(request.guestLocale)}`);
  if (request.note) lines.push(`💬 Комментарий: ${escapeHtml(request.note)}`);

  return lines.join('\n');
}

function networkFailure(reason: unknown): TelegramDeliveryError {
  if (reason instanceof DOMException && reason.name === 'AbortError') {
    return new TelegramDeliveryError('TELEGRAM_TIMEOUT', 'Telegram request timed out');
  }
  return new TelegramDeliveryError('TELEGRAM_NETWORK_ERROR', 'Telegram network request failed');
}

export async function sendTelegramMessage(
  fetcher: TelegramFetcher,
  token: string,
  chatId: string,
  text: string,
): Promise<{ messageId: number }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TELEGRAM_TIMEOUT_MS);

  try {
    const response = await fetcher(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: TELEGRAM_PARSE_MODE }),
      signal: controller.signal,
    });
    if (!response.ok) {
      let refusal: unknown = null;
      try {
        refusal = await response.json();
      } catch {
        // An unreadable refusal is still a refusal; classify it by status alone.
      }
      throw classifyTelegramRefusal(response.status, refusal);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      if (controller.signal.aborted) {
        throw new TelegramDeliveryError('TELEGRAM_TIMEOUT', 'Telegram request timed out');
      }
      throw new TelegramDeliveryError('TELEGRAM_RESPONSE_INVALID', 'Telegram response was invalid');
    }

    const result = payload && typeof payload === 'object'
      ? (payload as { ok?: unknown; result?: { message_id?: unknown } }).result
      : undefined;
    if (!payload || typeof payload !== 'object' || (payload as { ok?: unknown }).ok !== true ||
      !result || typeof result.message_id !== 'number') {
      throw new TelegramDeliveryError('TELEGRAM_RESPONSE_INVALID', 'Telegram response was invalid');
    }
    return { messageId: result.message_id };
  } catch (reason) {
    if (reason instanceof TelegramDeliveryError) throw reason;
    if (controller.signal.aborted) {
      throw new TelegramDeliveryError('TELEGRAM_TIMEOUT', 'Telegram request timed out');
    }
    throw networkFailure(reason);
  } finally {
    clearTimeout(timeout);
  }
}
