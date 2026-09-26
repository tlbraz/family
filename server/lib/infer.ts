import type { BringItem, EventType } from '../../shared/types';

// Makes events typed in Google (by hand or by the Claude app) look like app events:
// type from keywords, family members from names in the text, "Bring:" line → checklist.
// Portuguese and English, accents ignored.

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

const KEYWORDS: [EventType, string[]][] = [
  ['party', ['party', 'festa', 'aniversario', 'anos', 'birthday', 'parabens', 'bday']],
  ['medical', ['dentist', 'dentista', 'doctor', 'medico', 'medica', 'pediatra', 'paediatrician', 'pediatrician', 'consulta', 'vacina', 'vaccine', 'hospital', 'clinica', 'cuf', 'analises', 'ortodontista', 'oftalmologista', 'terapia', 'therapy', 'fisioterapia', 'psicologa', 'psicologo', 'farmacia']],
  ['sports', ['football', 'futebol', 'futsal', 'swimming', 'swim', 'natacao', 'piscina', 'treino', 'training', 'ginastica', 'gym', 'basket', 'basquetebol', 'tenis', 'tennis', 'judo', 'karate', 'danca', 'dance', 'ballet', 'jogo', 'match', 'surf', 'padel', 'hoquei', 'atletismo', 'andebol', 'volei']],
  ['school', ['school', 'escola', 'colegio', 'reuniao de pais', 'parents meeting', 'professora', 'professor', 'teacher', 'visita de estudo', 'field trip', 'teste', 'ficha', 'trabalho de casa', 'homework', 'atl', 'explicacao', 'tutoring', 'matricula']],
  ['holiday', ['ferias', 'holiday', 'holidays', 'vacation', 'viagem', 'trip', 'voo', 'flight']],
  ['family', ['avos', 'avo', 'grandparents', 'grandma', 'grandpa', 'jantar', 'almoco', 'lunch', 'dinner', 'familia', 'family']],
  ['work', ['trabalho', 'work', 'office', 'escritorio']],
];

const EMOJI: Record<string, EventType> = { '🩺': 'medical', '⚽': 'sports', '🎒': 'school', '🎉': 'party', '🏠': 'family', '💼': 'work', '🌴': 'holiday', '📌': 'other' };

const hasWord = (text: string, word: string) => new RegExp(`(^|[^\\p{L}])${word.replace(/ /g, '\\s+')}($|[^\\p{L}])`, 'u').test(text);

export function inferType(title: string, description: string | null): EventType {
  const first = [...title.trim()][0] ?? '';
  if (EMOJI[first]) return EMOJI[first];
  const t = fold(title);
  for (const [type, words] of KEYWORDS) if (words.some((w) => hasWord(t, w))) return type;
  const d = fold(description ?? '');
  for (const [type, words] of KEYWORDS) if (words.some((w) => hasWord(d, w))) return type;
  return 'other';
}

const ALL = ['everyone', 'todos', 'toda a familia', 'whole family', 'all of us'];
const KIDS = ['kids', 'children', 'miudos', 'criancas', 'filhos', 'meninos'];

/** Family members named in the text: full name, or a unique first 3+ letters ("Gui" → Guilherme). */
export function inferPeople(text: string, members: { id: number; name: string; role: string }[]): number[] {
  const t = fold(text);
  if (ALL.some((w) => hasWord(t, w))) return members.map((m) => m.id);
  const found = new Set<number>();
  if (KIDS.some((w) => hasWord(t, w))) members.filter((m) => m.role === 'kid').forEach((m) => found.add(m.id));
  const words = t.match(/\p{L}{3,}/gu) ?? [];
  for (const m of members) {
    const name = fold(m.name);
    if (hasWord(t, name)) {
      found.add(m.id);
      continue;
    }
    for (const w of words) {
      if (name.startsWith(w) && members.filter((o) => fold(o.name).startsWith(w)).length === 1) found.add(m.id);
    }
  }
  return [...found];
}

const BRING = /^\s*(?:[-•*]\s*)?(bring|levar|trazer|take|to bring|nao esquecer|don'?t forget)\s*:\s*(.+)$/i;

/** Splits a "Bring: a, b" line out of the notes. */
export function extractBring(description: string | null): { bring: BringItem[]; notes: string | null } {
  if (!description) return { bring: [], notes: null };
  const text = description.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''); // Google may send HTML
  const bring: BringItem[] = [];
  const keep: string[] = [];
  for (const line of text.split('\n')) {
    const m = BRING.exec(fold(line)) ? line.slice(line.indexOf(':') + 1) : null;
    if (m === null) keep.push(line);
    else for (const item of m.split(/[,;·•]|\s+e\s+|\s+and\s+/)) if (item.trim()) bring.push({ text: item.trim().slice(0, 80), done: false });
  }
  const notes = keep.join('\n').replace(/— (?:family\.lan|https?:\/\/\S+)$/gm, '').trim();
  return { bring: bring.slice(0, 30), notes: notes || null };
}

/** Our own push format is "<emoji> Title · Names"; people typing in Google may add an emoji too. */
export function cleanTitle(title: string): string {
  const first = [...title.trim()][0] ?? '';
  return (EMOJI[first] ? title.trim().slice(first.length) : title).trim() || '(no title)';
}
