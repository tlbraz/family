// Shades of one colour for drilling into a category: its parts keep the parent's hue, stepped in lightness
// (an ordinal one-hue ramp: ≥0.06 OKLCH L between steps, the faint end still ≥2:1 on the card).
// Biggest part gets the strongest step (darkest on light cards, brightest on dark ones).

const s2l = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const l2s = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function toOklch(hex: string): [number, number, number] {
  const [r, g, b] = [1, 3, 5].map((i) => s2l(parseInt(hex.slice(i, i + 2), 16) / 255)) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(a, B), Math.atan2(B, a)];
}

function fromOklch(L: number, C: number, h: number): number[] {
  const a = C * Math.cos(h), b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
}

const hex = (lin: number[]) => `#${lin.map((c) => Math.round(l2s(Math.min(1, Math.max(0, c))) * 255).toString(16).padStart(2, '0')).join('')}`;

const RAMP = { light: [0.4, 0.72], dark: [0.8, 0.48] } as const; // strong end → faint end
export const MAX_SHADES = 6;

/** n shades of `base` (a #rrggbb), strongest first. Past MAX_SHADES the rest should be shown gray. */
export function shadesOf(base: string, n: number, dark: boolean): string[] {
  if (!/^#[0-9a-f]{6}$/i.test(base) || n < 1) return [];
  const [, C, h] = toOklch(base);
  const [from, to] = dark ? RAMP.dark : RAMP.light;
  const count = Math.min(n, MAX_SHADES);
  const step = count > 1 ? Math.min(0.16, Math.abs(to - from) / (count - 1)) : 0; // spread wide when there are few
  return Array.from({ length: count }, (_, i) => {
    const L = from + Math.sign(to - from) * step * i;
    let c = C; // bring the chroma down until the colour fits in sRGB
    while (c > 0 && fromOklch(L, c, h).some((v) => v < -0.0005 || v > 1.0005)) c -= 0.005;
    return hex(fromOklch(L, Math.max(0, c), h));
  });
}
