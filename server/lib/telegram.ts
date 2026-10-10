import { eq } from 'drizzle-orm';
import type { Db } from '../db';
import { settings } from '../schema';

/**
 * Telegram messages from the family bot. Every message goes to every recipient:
 * the chats in TELEGRAM_CHAT_ID (comma-separated) plus the ones added on the Family page.
 * Only TELEGRAM_BOT_TOKEN is needed to start: the Family page card can add everyone, including the first person.
 */
export interface TelegramChat {
  id: string;
  name: string;
}

const SAVED_KEY = 'telegram:chats';
const SEEN_KEY = 'telegram:seen'; // everyone who has written to the bot: chat id → name
const OFFSET_KEY = 'telegram:offset';
let saved: TelegramChat[] = [];
let seen: Record<string, string> = {};

const envChats = () => (process.env.TELEGRAM_CHAT_ID ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const recipientIds = () => [...new Set([...envChats(), ...saved.map((c) => c.id)])];

export const telegramEnabled = () => !!process.env.TELEGRAM_BOT_TOKEN && recipientIds().length > 0;

async function call<T>(method: string, body?: unknown): Promise<T | null> {
  const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  }).catch(() => null);
  if (!res?.ok) {
    console.error(`telegram ${method} failed: ${res?.status ?? 'network error'}`); // never log the URL (token)
    return null;
  }
  return ((await res.json()) as { result: T }).result;
}

/** Sends to every recipient (or just `only`). True when at least one got it, so a digest isn't re-sent to the others. */
export async function sendTelegram(html: string, only?: string): Promise<boolean> {
  if (!process.env.TELEGRAM_BOT_TOKEN) return false;
  const to = only ? [only] : recipientIds();
  const results = await Promise.all(
    to.map((chat_id) => call('sendMessage', { chat_id, text: html.slice(0, 4000), parse_mode: 'HTML', disable_web_page_preview: true })),
  );
  return results.some(Boolean);
}

/** A picture (by URL) with an HTML caption to every recipient; a chat where the picture fails gets the text. */
export async function sendTelegramPhoto(photo: string, caption: string): Promise<boolean> {
  if (!process.env.TELEGRAM_BOT_TOKEN) return false;
  const results = await Promise.all(
    recipientIds().map(async (chat_id) =>
      (await call('sendPhoto', { chat_id, photo, caption: caption.slice(0, 1000), parse_mode: 'HTML' })) ??
      call('sendMessage', { chat_id, text: caption.slice(0, 4000), parse_mode: 'HTML', disable_web_page_preview: true }),
    ),
  );
  return results.some(Boolean);
}

export const esc =(s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function getSetting(db: Db, key: string) {
  const [row] = await db.select().from(settings).where(eq(settings.key, key));
  return row?.value ?? null;
}

async function setSetting(db: Db, key: string, value: string) {
  await db.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } });
}

/** Loads the recipients added on the Family page (at startup). */
export async function loadTelegramChats(db: Db) {
  saved = JSON.parse((await getSetting(db, SAVED_KEY)) ?? '[]') as TelegramChat[];
  seen = JSON.parse((await getSetting(db, SEEN_KEY)) ?? '{}') as Record<string, string>;
}

async function save(db: Db, chats: TelegramChat[]) {
  await setSetting(db, SAVED_KEY, JSON.stringify(chats));
  saved = chats;
}

export const addTelegramChat = (db: Db, chat: TelegramChat) => save(db, [...saved.filter((c) => c.id !== chat.id), chat]);
export const removeTelegramChat = (db: Db, id: string) => save(db, saved.filter((c) => c.id !== id));

interface Chat {
  id: number;
  type: string;
  title?: string;
  first_name?: string;
  last_name?: string;
  username?: string;
}
interface Update {
  update_id: number;
  message?: { chat: Chat; text?: string; date: number };
  my_chat_member?: { chat: Chat };
}

/** A text someone sent the bot in a private chat. */
export interface Incoming {
  chatId: string;
  text: string;
  at: Date;
}

/**
 * Reads what people send the bot (long polling; the app isn't reachable from the internet for a webhook).
 * Remembers who wrote, for the Family page, and hands private texts to `onText`. Runs until `stop()`.
 */
export function pollTelegram(db: Db, onText: (m: Incoming) => Promise<string | null>) {
  let running = true;
  void (async () => {
    let offset = Number((await getSetting(db, OFFSET_KEY).catch(() => null)) ?? 0);
    while (running) {
      const updates = await call<Update[]>('getUpdates', { offset, timeout: 30, allowed_updates: ['message', 'my_chat_member'] });
      if (!updates) {
        await new Promise((r) => setTimeout(r, 15_000)); // Telegram down, or another copy polling during a deploy
        continue;
      }
      for (const u of updates) {
        offset = u.update_id + 1;
        const chat = (u.message ?? u.my_chat_member)?.chat;
        if (!chat) continue;
        const id = String(chat.id);
        const name = chat.title ?? ([chat.first_name, chat.last_name].filter(Boolean).join(' ') || chat.username || id);
        if (seen[id] !== name) {
          seen = { ...seen, [id]: name };
          await setSetting(db, SEEN_KEY, JSON.stringify(seen)).catch(() => {});
        }
        if (u.message?.text && chat.type === 'private') {
          const reply = await onText({ chatId: id, text: u.message.text, at: new Date(u.message.date * 1000) }).catch((e: Error) => {
            console.error('telegram message:', e.message);
            return 'Something went wrong saving that. Try again in a moment.';
          });
          if (reply) await sendTelegram(reply, id);
        }
      }
      if (updates.length) await setSetting(db, OFFSET_KEY, String(offset)).catch(() => {});
    }
  })();
  return { stop: () => void (running = false) };
}

/** For the Family page: the bot's link, who gets the messages, and who has written to the bot but isn't added yet. */
export async function telegramStatus() {
  const me = await call<{ username: string }>('getMe');
  const names = new Map(Object.entries(seen));
  const env = envChats();
  // Nobody left to message = digests are paused (telegramEnabled is false) until someone is added.
  const recipients = [
    ...env.map((id) => ({ id, name: names.get(id) ?? 'Set on the server', fixed: true })),
    ...saved.filter((c) => !env.includes(c.id)).map((c) => ({ ...c, fixed: false })),
  ];
  const ids = new Set(recipients.map((r) => r.id));
  return {
    bot: me?.username ?? null,
    recipients,
    waiting: [...names].filter(([id]) => !ids.has(id)).map(([id, name]) => ({ id, name })),
  };
}
