/// <reference lib="deno.ns" />

import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import {
  classifyTelegramRefusal,
  deliveryFailureRecord,
  formatTelegramRequest,
  sendTelegramMessage,
  TelegramDeliveryError,
} from './telegram.ts';

const transportFixture = {
  reference: 'MG-ABCDEFGH',
  hotelName: 'Kamilovs Hotel',
  roomLabel: '205',
  service: 'transport' as const,
  choice: '',
  pickup: 'Kamilovs Hotel',
  destination: 'Samarkand Airport',
  requestedDate: '2099-12-31',
  requestedTime: '14:30',
  partySize: 2,
  guestName: 'Alex',
  contact: '+998 90 123 45 67',
  note: '',
};

Deno.test('formats transport request in Russian', () => {
  const text = formatTelegramRequest(transportFixture, 'Asia/Tashkent');

  assertStringIncludes(text, '🆕 Новая заявка MG-ABCDEFGH');
  assertStringIncludes(text, '🏨 Отель: Kamilovs Hotel');
  assertStringIncludes(text, '🚪 Комната: 205');
  assertStringIncludes(text, '🧭 Услуга: Транспорт');
  assertStringIncludes(text, '➡️ Куда: Samarkand Airport');
  assert(!text.includes('Комментарий: undefined'));
});

Deno.test('escapes guest and database values for Telegram HTML', () => {
  const text = formatTelegramRequest({
    ...transportFixture,
    hotelName: '<Hotel & Co>',
    guestName: '<Alex & friends>',
    note: 'Call <now> & confirm',
  }, 'Asia/Tashkent');

  assertStringIncludes(text, '&lt;Hotel &amp; Co&gt;');
  assertStringIncludes(text, '&lt;Alex &amp; friends&gt;');
  assertStringIncludes(text, 'Call &lt;now&gt; &amp; confirm');
});

Deno.test('sends an HTML Telegram message and returns only its message id', async () => {
  let sentUrl = '';
  let sentBody: Record<string, unknown> | undefined;
  const messageId = await sendTelegramMessage((url: RequestInfo | URL, init?: RequestInit) => {
    sentUrl = String(url);
    sentBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Promise.resolve(new Response(JSON.stringify({ ok: true, result: { message_id: 42 } }), { status: 200 }));
  }, 'test-bot-token', '-100123', '<b>Заявка</b>');

  assertStringIncludes(sentUrl, '/sendMessage');
  assertEquals(sentBody, {
    chat_id: '-100123',
    text: '<b>Заявка</b>',
    parse_mode: 'HTML',
  });
  assertEquals(messageId, { messageId: 42 });
});

Deno.test('classifies a Telegram API failure without exposing its response body', async () => {
  let caught: unknown;
  try {
    await sendTelegramMessage(
      () => Promise.resolve(new Response(JSON.stringify({ description: 'chat is invalid: +998 90 123 45 67' }), { status: 400 })),
      'test-bot-token',
      '-100123',
      'request',
    );
  } catch (reason) {
    caught = reason;
  }

  assert(caught instanceof Error);
  assertEquals(caught.name, 'TelegramDeliveryError');
  assertStringIncludes(caught.message, 'Telegram API request failed');
  assertEquals(caught.message.includes('+998 90 123 45 67'), false);
  assertEquals(caught.message.includes('test-bot-token'), false);
});

Deno.test('keeps the abort timeout active while a Telegram response body stalls', async () => {
  const originalSetTimeout = globalThis.setTimeout;
  let aborted = false;
  globalThis.setTimeout = ((callback: TimerHandler, _timeout?: number, ...args: unknown[]) =>
    originalSetTimeout(callback, 1, ...args)) as typeof setTimeout;

  try {
    const result = await Promise.race([
      sendTelegramMessage((_, init) => {
        const signal = init?.signal;
        return Promise.resolve({
          ok: true,
          json: () => new Promise((_, reject) => {
            signal?.addEventListener('abort', () => {
              aborted = true;
              reject(new DOMException('aborted', 'AbortError'));
            }, { once: true });
          }),
        } as unknown as Response);
      }, 'test-bot-token', '-100123', 'request').then(() => 'resolved', () => 'rejected'),
      new Promise<string>((resolve) => originalSetTimeout(() => resolve('test-timeout'), 50)),
    ]);

    assertEquals(result, 'rejected');
    assertEquals(aborted, true);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
});

Deno.test('tells the team which language to answer the guest in', () => {
  assertStringIncludes(formatTelegramRequest(transportFixture, 'Asia/Tashkent'), '🌐 Язык гостя: английский');
  assertStringIncludes(formatTelegramRequest({ ...transportFixture, guestLocale: 'zh' }, 'Asia/Tashkent'), '🌐 Язык гостя: китайский');
  assertStringIncludes(formatTelegramRequest({ ...transportFixture, guestLocale: 'uz' }, 'Asia/Tashkent'), '🌐 Язык гостя: узбекский');
  assertStringIncludes(formatTelegramRequest({ ...transportFixture, guestLocale: 'ru' }, 'Asia/Tashkent'), '🌐 Язык гостя: русский');
});

Deno.test('marks an as-soon-as-possible request in the title and the time line', () => {
  const text = formatTelegramRequest({ ...transportFixture, requestedTime: null, asap: true }, 'Asia/Tashkent');
  assertStringIncludes(text, '<b>🆕 Новая заявка MG-ABCDEFGH ⚡ срочно</b>');
  assertStringIncludes(text, '🕒 Время: ⚡ как можно скорее');
  assert(!formatTelegramRequest(transportFixture, 'Asia/Tashkent').includes('срочно'));
});

function refusal(status: number, body: unknown) {
  return () => Promise.resolve(new Response(JSON.stringify(body), { status }));
}

async function refusalCode(status: number, body: unknown): Promise<TelegramDeliveryError> {
  try {
    await sendTelegramMessage(refusal(status, body), 'test-bot-token', '-100123', 'request');
  } catch (reason) {
    if (reason instanceof TelegramDeliveryError) return reason;
    throw reason;
  }
  throw new Error('expected a refusal');
}

Deno.test('names the refusal when the bot was removed from the group', async () => {
  const error = await refusalCode(403, { ok: false, error_code: 403, description: 'Forbidden: bot was kicked from the group chat' });
  assertEquals(error.code, 'TELEGRAM_BOT_REMOVED');
});

Deno.test('keeps the new id when the group became a supergroup', async () => {
  const error = await refusalCode(400, {
    ok: false,
    error_code: 400,
    description: 'Bad Request: group chat was upgraded to a supergroup chat',
    parameters: { migrate_to_chat_id: -1002233445566 },
  });
  assertEquals(error.code, 'TELEGRAM_CHAT_MIGRATED');
  assertEquals(error.migrateToChatId, -1002233445566);
  assertEquals(deliveryFailureRecord(error), {
    code: 'TELEGRAM_CHAT_MIGRATED',
    message: 'The group was upgraded to a supergroup; new chat id -1002233445566',
  });
});

Deno.test('tells a revoked token, a missing chat, missing rights and a rate limit apart', () => {
  assertEquals(classifyTelegramRefusal(401, { description: 'Unauthorized' }).code, 'TELEGRAM_BOT_TOKEN_INVALID');
  assertEquals(classifyTelegramRefusal(400, { description: 'Bad Request: chat not found' }).code, 'TELEGRAM_CHAT_NOT_FOUND');
  assertEquals(classifyTelegramRefusal(400, { description: 'Bad Request: not enough rights to send text messages to the chat' }).code, 'TELEGRAM_BOT_NO_RIGHTS');
  assertEquals(classifyTelegramRefusal(429, { description: 'Too Many Requests: retry after 5' }).code, 'TELEGRAM_RATE_LIMITED');
  assertEquals(classifyTelegramRefusal(400, { description: "Bad Request: can't parse entities" }).code, 'TELEGRAM_MESSAGE_REJECTED');
});

Deno.test('falls back to the general code for a refusal it does not recognise, or cannot read', async () => {
  assertEquals(classifyTelegramRefusal(400, { description: 'Bad Request: something new' }).code, 'TELEGRAM_API_ERROR');
  const unreadable = await (async () => {
    try {
      await sendTelegramMessage(() => Promise.resolve(new Response('<html>bad gateway</html>', { status: 502 })), 'test-bot-token', '-100123', 'request');
    } catch (reason) {
      return reason as TelegramDeliveryError;
    }
  })();
  assertEquals(unreadable?.code, 'TELEGRAM_API_ERROR');
});

Deno.test('never stores Telegram text, which can echo a guest phone number', () => {
  const echoed = classifyTelegramRefusal(400, { description: 'Bad Request: chat is invalid: +998 90 123 45 67' });
  const record = deliveryFailureRecord(echoed);
  assertEquals(record.message.includes('+998'), false);
  // A message raised elsewhere with a known code still gets the fixed wording.
  assertEquals(deliveryFailureRecord(new TelegramDeliveryError('TELEGRAM_BOT_REMOVED', 'guest +998 90 123 45 67')).message, 'The bot cannot write to the group');
  assertEquals(deliveryFailureRecord(new TelegramDeliveryError('SOMETHING_ELSE', 'x')).code, 'TELEGRAM_DELIVERY_FAILED');
  assertEquals(deliveryFailureRecord(new Error('boom')).code, 'TELEGRAM_DELIVERY_FAILED');
});
