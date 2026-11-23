// The fixed goal palette: eight pastels, picked for separation between neighbours in this order
// (also under colour-vision deficiency). A goal stores the key, never the hex value.
//
// On the dark chart surface every colour stands out at 3:1 or more. On the light surface pastels
// stay below 3:1 by design, so charts that use them must also name the goals (legend or labels).
// Text on a coloured fill uses the dark text colour; white text is too faint on every pastel.

export const PALETTE = {
  rose: "#f998c8",
  lime: "#c9dd76",
  amber: "#e6a64c",
  mint: "#5eedd0",
  lavender: "#b7a6ff",
  peach: "#f4c5b2",
  sky: "#77cfff",
  sage: "#9bbf9f",
} as const;

export type PaletteKey = keyof typeof PALETTE;

/** Palette keys in their fixed order; new goals take the first one no active goal uses. */
export const PALETTE_KEYS = Object.keys(PALETTE) as PaletteKey[];

/** Chart surfaces: the card colour of the light and the dark theme (see style.css). */
export const CHART_BACKGROUND = { light: "#ffffff", dark: "#1f2832" } as const;

/** Text colours a label on a coloured fill can use. */
export const TEXT = { white: "#ffffff", dark: "#1f2933" } as const;

export const isPaletteKey = (s: string): s is PaletteKey => Object.hasOwn(PALETTE, s);

/** WCAG 2 contrast ratio between two #rrggbb colours, from 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The text colour (white or dark) that reads best on a palette colour. */
export function textOn(key: PaletteKey): string {
  const fill = PALETTE[key];
  return contrastRatio(fill, TEXT.dark) >= contrastRatio(fill, TEXT.white) ? TEXT.dark : TEXT.white;
}

/** Simple string hash, so a goal without a colour always gets the same one. */
function hash(s: string): number {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

/** The colour a goal shows: its own key, or for a goal without one a fixed pick from its id. */
export function goalColor(goal: { id: string; color: PaletteKey | "" }): PaletteKey {
  return goal.color || PALETTE_KEYS[hash(goal.id) % PALETTE_KEYS.length];
}

/** The colour for a new goal: the first key no active goal uses, else the least used one. */
export function nextColor(goals: { color: PaletteKey | ""; archived: boolean }[]): PaletteKey {
  const uses = new Map(PALETTE_KEYS.map((k) => [k, 0]));
  for (const g of goals) if (!g.archived && g.color) uses.set(g.color, uses.get(g.color)! + 1);
  return PALETTE_KEYS.reduce((best, k) => (uses.get(k)! < uses.get(best)! ? k : best));
}
