// Category colours, validated for colour-blind separation on the light and dark cards (see styles.css --m1…--m12).
// A group keeps its colour by its place in Actual (among the groups in use), not by how much was spent; past the
// 12th it goes gray. Every colour has its name next to it, so colour is never the only way to tell them apart.
const SLOTS = 12;
export const colourOf = (id: string, order: string[]) => {
  const i = order.indexOf(id);
  return i >= 0 && i < SLOTS ? `var(--m${i + 1})` : 'var(--m-other)';
};
