/** Telegram messages to the parents' chat. Disabled unless both env vars are set. */
export const telegramEnabled = () => !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);

export async function sendTelegram(html: string): Promise<boolean> {
  if (!telegramEnabled()) return false;
  const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: process.env.TELEGRAM_CHAT_ID,
      text: html.slice(0, 4000),
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  }).catch(() => null);
  if (!res?.ok) console.error(`telegram send failed: ${res?.status ?? 'network error'}`); // never log the URL (token)
  return !!res?.ok;
}

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
