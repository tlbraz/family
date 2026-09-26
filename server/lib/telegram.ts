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
let saved: TelegramChat[] = [];

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

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Loads the recipients added on the Family page (at startup). */
export async function loadTelegramChats(db: Db) {
  const [row] = await db.select().from(settings).where(eq(settings.key, SAVED_KEY));
  saved = row ? (JSON.parse(row.value) as TelegramChat[]) : [];
}

async function save(db: Db, chats: TelegramChat[]) {
  const value = JSON.stringify(chats);
  await db.insert(settings).values({ key: SAVED_KEY, value }).onConflictDoUpdate({ target: settings.key, set: { value } });
  saved = chats;
}

export const addTelegramChat = (db: Db, chat: TelegramChat) => save(db, [...saved.filter((c) => c.id !== chat.id), chat]);
export const removeTelegramChat = (db: Db, id: string) => save(db, saved.filter((c) => c.id !== id));

interface Update {
  message?: { chat: { id: number; type: string; title?: string; first_name?: string; last_name?: string; username?: string } };
  my_chat_member?: Update['message'];
}

/** For the Family page: the bot's link, who gets the messages, and who has tapped Start but isn't added yet. */
export async function telegramStatus() {
  const [me, updates] = await Promise.all([call<{ username: string }>('getMe'), call<Update[]>('getUpdates', { allowed_updates: ['message', 'my_chat_member'] })]);
  const names = new Map<string, string>();
  for (const u of updates ?? []) {
    const chat = (u.message ?? u.my_chat_member)?.chat;
    if (!chat) continue;
    const name = chat.title ?? ([chat.first_name, chat.last_name].filter(Boolean).join(' ') || chat.username || String(chat.id));
    names.set(String(chat.id), name);
  }
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
