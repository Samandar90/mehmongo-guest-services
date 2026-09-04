/// <reference lib="deno.ns" />

import { assert, assertEquals, assertStringIncludes } from '@std/assert';
import { formatTelegramRequest, sendTelegramMessage } from './telegram.ts';

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
