// Blood pressure: types and the "128/82 after training" parser used by the app and the Telegram bot.

export interface BpReading {
  id: number;
  at: string; // ISO
  systolic: number;
  diastolic: number;
  tags: string[];
  note: string | null;
}

export type BpInput = Omit<BpReading, 'id'>;

export interface BpLog {
  tracking: boolean;
  telegramId: string | null;
  readings: BpReading[]; // newest first
  tags: string[]; // to offer as chips, most used first
}

export const BP_TAGS = ['Forgot meds', 'After training', 'Stressed', 'Coffee', 'Bad sleep', 'Alcohol', 'Sick', 'Salty meal'];

/** Home readings at or above this are considered high (ESH). */
export const BP_HIGH = { systolic: 135, diastolic: 85 };
export const isHigh = (r: Pick<BpReading, 'systolic' | 'diastolic'>) => r.systolic >= BP_HIGH.systolic || r.diastolic >= BP_HIGH.diastolic;

export const validBp = (systolic: number, diastolic: number) =>
  systolic >= 60 && systolic <= 260 && diastolic >= 30 && diastolic <= 160 && systolic > diastolic;

// Other ways of saying the built-in tags (lower case, matched as whole words).
const ALIASES: Record<string, string[]> = {
  'Forgot meds': ['forgot meds', 'forgot pills', 'no meds', 'missed meds', 'esqueci', 'sem medicação'],
  'After training': ['after training', 'training', 'workout', 'gym', 'run', 'treino', 'ginásio', 'corrida'],
  Stressed: ['stressed', 'stress', 'stressful', 'stressado'],
  Coffee: ['coffee', 'café', 'cafe'],
  'Bad sleep': ['bad sleep', 'slept badly', 'poor sleep', 'no sleep', 'dormi mal'],
  Alcohol: ['alcohol', 'wine', 'beer', 'drinks', 'vinho', 'cerveja'],
  Sick: ['sick', 'ill', 'fever', 'doente', 'febre'],
  'Salty meal': ['salty meal', 'salty', 'salt', 'salgado'],
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * "128/82", "128 82", "128-82 after training, coffee" → the numbers, any known tags mentioned
 * and whatever is left as a note. Null when there are no plausible numbers at the start.
 */
export function parseBp(text: string, known: string[] = BP_TAGS): { systolic: number; diastolic: number; tags: string[]; note: string | null } | null {
  const m = text.trim().match(/^(\d{2,3})\s*(?:\/|\\|-|x|\s)\s*(\d{2,3})\b(.*)$/is);
  if (!m) return null;
  const systolic = Number(m[1]);
  const diastolic = Number(m[2]);
  if (!validBp(systolic, diastolic)) return null;
  let rest = ` ${m[3]!} `;
  const tags: string[] = [];
  for (const tag of known) {
    const words = [tag.toLowerCase(), ...(ALIASES[tag] ?? [])].sort((a, b) => b.length - a.length);
    for (const w of words) {
      const re = new RegExp(`(^|[\\s,;.+#&])${escape(w)}(?=$|[\\s,;.!+&])`, 'iu');
      if (re.test(rest)) {
        if (!tags.includes(tag)) tags.push(tag);
        rest = rest.replace(re, '$1');
      }
    }
  }
  const note = rest.replace(/[\s,;.+#&]+/g, ' ').replace(/^\s*(and|e)\s+|\s+(and|e)\s*$/gi, '').trim();
  return { systolic, diastolic, tags, note: note || null };
}

/** Morning (before noon) or evening, from the local time of a reading. */
export const partOfDay = (iso: string) => (new Date(iso).getHours() < 12 ? 'morning' : 'evening');
