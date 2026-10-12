import type { MoneySummary } from '../../../shared/types';

// Category colours, validated for colour-blind separation on the light and dark cards (see styles.css --m1…--m12).
// A group keeps its colour by its place in Actual (among the groups in use), not by how much was spent; past the
// 12th it goes gray. Every colour has its name next to it, so colour is never the only way to tell them apart.
const SLOTS = 12;
export const colourOf = (id: string, order: string[]) => {
  const i = order.indexOf(id);
  return i >= 0 && i < SLOTS ? `var(--m${i + 1})` : 'var(--m-other)';
};

// A third level, by name: a group called "Casa / Energia" sits under "Casa" (Actual itself has only groups and
// categories). Groups without a "/" stay on their own. Colours go by the top level, so all of Casa shares one.
export const splitGroup = (name: string) => {
  const i = name.indexOf('/');
  const top = i > 0 ? name.slice(0, i).trim() : '';
  const sub = i > 0 ? name.slice(i + 1).trim() : '';
  return top && sub ? { top, sub } : null;
};

/** The colour key of a group (its top level when it has one), the colour order, and a group's colour. */
export function groupColours(data: Pick<MoneySummary, 'pickable' | 'groups' | 'groupOrder'>) {
  const nameOf = new Map([...data.pickable, ...data.groups].map((g) => [g.id, g.name] as const));
  const keyOf = (groupId: string) => {
    const parts = splitGroup(nameOf.get(groupId) ?? '');
    return parts ? `top:${parts.top}` : groupId;
  };
  const order = [...new Set(data.groupOrder.map(keyOf))];
  return { keyOf, order, colour: (groupId: string) => colourOf(keyOf(groupId), order) };
}
