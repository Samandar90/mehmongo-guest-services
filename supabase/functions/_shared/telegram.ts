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
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'TelegramDeliveryError';
  }
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
    `<b>🆕 Новая заявка ${escapeHtml(request.reference)}</b>`,
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
  if (request.requestedTime) lines.push(`🕒 Время: ${escapeHtml(request.requestedTime)}`);
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
      throw new TelegramDeliveryError('TELEGRAM_API_ERROR', 'Telegram API request failed');
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
