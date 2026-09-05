#!/usr/bin/env node
/**
 * Checks the local Telegram configuration without printing any secret.
 *
 *   node scripts/check-telegram.mjs            # bot identity + visible chats
 *   node scripts/check-telegram.mjs --send     # also posts one test message
 *
 * Reads TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID from supabase/.env.local, which
 * is git-ignored. The token is never printed, logged or sent anywhere except
 * api.telegram.org.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const envPath = path.join(projectDir, 'supabase', '.env.local');

function parseEnv(text) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.trim());
    if (match) values[match[1]] = match[2].replace(/^["']|["']$/g, '').trim();
  }
  return values;
}

function fingerprint(token) {
  // Enough to tell two tokens apart in a log, not enough to use one.
  const botId = token.split(':')[0];
  return `bot ${botId}, secret part hidden (${token.length} characters)`;
}

let env;
try {
  env = parseEnv(await readFile(envPath, 'utf8'));
} catch {
  console.error(`No ${path.relative(projectDir, envPath)} yet. Create it with TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID and REQUEST_HASH_SECRET.`);
  process.exit(1);
}

const token = env.TELEGRAM_BOT_TOKEN;
const chatId = env.TELEGRAM_CHAT_ID;

if (!token || /placeholder|example|change-me/i.test(token)) {
  console.error('TELEGRAM_BOT_TOKEN is missing or still a placeholder. Put the real token from @BotFather into supabase/.env.local.');
  process.exit(2);
}
console.log(`Token found: ${fingerprint(token)}`);

async function telegram(method, params = {}) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
  });
  const payload = await response.json().catch(() => ({}));
  if (!payload.ok) {
    // Telegram echoes the method, never the token, in its error text.
    throw new Error(`${method} failed: ${payload.description ?? response.status}`);
  }
  return payload.result;
}

const me = await telegram('getMe');
console.log(`Bot: @${me.username} (${me.first_name})`);
console.log(`Can read all group messages: ${me.can_read_all_group_messages ? 'yes' : 'no (privacy mode on)'}`);

const updates = await telegram('getUpdates', { limit: 20, allowed_updates: ['message', 'my_chat_member', 'channel_post'] });
const chats = new Map();
for (const update of updates) {
  const chat = update.message?.chat ?? update.channel_post?.chat ?? update.my_chat_member?.chat;
  if (chat) chats.set(chat.id, chat);
}

if (chats.size === 0) {
  console.log('\nNo chats visible yet. Add the bot to your group, then write any message there and run this again.');
} else {
  console.log('\nChats this bot can see:');
  for (const chat of chats.values()) {
    console.log(`  id ${chat.id}  ·  ${chat.type}  ·  ${chat.title ?? chat.username ?? 'private chat'}`);
  }
  console.log('\nPut the id of your MehmonGo group into TELEGRAM_CHAT_ID in supabase/.env.local (group ids start with -100).');
}

if (chatId && !/^-?\d+$/.test(chatId)) {
  console.log(`\nTELEGRAM_CHAT_ID is "${chatId}", which is not a numeric chat id.`);
} else if (chatId) {
  console.log(`\nConfigured TELEGRAM_CHAT_ID: ${chatId}`);
  if (process.argv.includes('--send')) {
    const sent = await telegram('sendMessage', {
      chat_id: chatId,
      text: '<b>MehmonGo</b>\nПроверка связи: бот настроен и может писать в эту группу.',
      parse_mode: 'HTML',
    });
    console.log(`Test message delivered, message id ${sent.message_id}.`);
  } else {
    console.log('Run with --send to post one test message into that chat.');
  }
}
