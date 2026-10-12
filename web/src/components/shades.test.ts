import { describe, expect, it } from 'vitest';
import { MAX_SHADES, shadesOf } from './shades';

describe('shadesOf', () => {
  it('steps one hue from strong to faint, at most MAX_SHADES', () => {
    const light = shadesOf('#b94b08', 9, false);
    expect(light).toHaveLength(MAX_SHADES);
    const lum = (h: string) => parseInt(h.slice(1, 3), 16) + parseInt(h.slice(3, 5), 16) + parseInt(h.slice(5, 7), 16);
    expect(light.map(lum)).toEqual([...light.map(lum)].sort((a, b) => a - b)); // darkest first on a light card
    const dark = shadesOf('#b54700', 3, true);
    expect(dark.map(lum)).toEqual([...dark.map(lum)].sort((a, b) => b - a)); // brightest first on a dark card
    expect(shadesOf('var(--m1)', 3, false)).toEqual([]);
  });
});
