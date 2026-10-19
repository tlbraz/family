import type { MoneySummary } from '../../../shared/types';

// Category colours (styles.css --m1…--m10), validated so every pair stays apart on the cards in both themes
// (OKLab ΔE ≥15.6 for normal vision; colour-blind pairs ≥6.6, fine because a name and icon sit next to every colour).
// The top levels of both budgets keep a fixed colour by name (a family one and a company one may share a colour: only
// one budget shows at a time); any other group takes the next free one, biggest spenders first (the server's order),
// and past the tenth it goes gray.
const SLOTS = 10;
const BY_NAME: [RegExp, number][] = [
  [/^casa\b|^escrit[oó]rio/i, 1], // orange
  [/^sa[uú]de/i, 2], // green
  [/^(miúdos|miudos|filhos|kids|sal[aá]rio)/i, 3], // blue
  [/^transport/i, 4], // purple
  [/^compras/i, 5], // pink
  [/^(finan|impost)/i, 6], // magenta
  [/^(bem.estar|pessoal)/i, 7], // lavender / indigo
  [/^lazer|leisure/i, 8], // cyan
  [/^(subscri|servi[cç]o)/i, 9], // wine
  [/^(alimenta|refei[cç])/i, 10], // olive
];

// A third level, by name: a group called "Casa / Energia" sits under "Casa" (Actual itself has only groups and
// categories). Groups without a "/" stay on their own. Colours go by the top level, so all of Casa shares one.
export const splitGroup = (name: string) => {
  const i = name.indexOf('/');
  const top = i > 0 ? name.slice(0, i).trim() : '';
  const sub = i > 0 ? name.slice(i + 1).trim() : '';
  return top && sub ? { top, sub } : null;
};

/** The colour key of a group (its top level when it has one), the colour of a key, and a group's colour. */
export function groupColours(data: Pick<MoneySummary, 'pickable' | 'groups' | 'groupOrder'>) {
  const nameOf = new Map([...data.pickable, ...data.groups].map((g) => [g.id, g.name] as const));
  const keyOf = (groupId: string) => {
    const parts = splitGroup(nameOf.get(groupId) ?? '');
    return parts ? `top:${parts.top}` : groupId;
  };
  const keyName = (key: string) => (key.startsWith('top:') ? key.slice(4) : nameOf.get(key) ?? '');
  const order = [...new Set(data.groupOrder.map(keyOf))];
  const slot = new Map<string, number>();
  for (const key of order) {
    const s = BY_NAME.find(([re]) => re.test(keyName(key)))?.[1];
    if (s && ![...slot.values()].includes(s)) slot.set(key, s);
  }
  const free = Array.from({ length: SLOTS }, (_, i) => i + 1).filter((s) => ![...slot.values()].includes(s));
  for (const key of order) if (!slot.has(key) && free.length) slot.set(key, free.shift()!);
  const keyColour = (key: string) => (slot.has(key) ? `var(--m${slot.get(key)})` : 'var(--m-other)');
  return { keyOf, keyColour, colour: (groupId: string) => keyColour(keyOf(groupId)) };
}
