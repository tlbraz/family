import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendTelegram, telegramEnabled } from './telegram';

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.TELEGRAM_BOT_TOKEN;
  delete process.env.TELEGRAM_CHAT_ID;
});

function stubFetch(failFor?: string) {
  const to: string[] = [];
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    const { chat_id } = JSON.parse(String(init.body));
    to.push(chat_id);
    return new Response(JSON.stringify({ ok: true, result: {} }), { status: chat_id === failFor ? 403 : 200 });
  });
  return to;
}

describe('telegram', () => {
  it('is off without a token or a chat', () => {
    process.env.TELEGRAM_CHAT_ID = '1';
    expect(telegramEnabled()).toBe(false);
  });

  it('sends to every chat in TELEGRAM_CHAT_ID', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 't';
    process.env.TELEGRAM_CHAT_ID = '-100123, 456';
    const to = stubFetch();
    expect(telegramEnabled()).toBe(true);
    expect(await sendTelegram('hi')).toBe(true);
    expect(to.sort()).toEqual(['-100123', '456']);
  });

  it('counts as sent when one chat fails, so the others are not messaged twice', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 't';
    process.env.TELEGRAM_CHAT_ID = '1,2';
    stubFetch('2');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await sendTelegram('hi')).toBe(true);
  });
});
