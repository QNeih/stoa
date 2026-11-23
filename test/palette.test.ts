import { describe, expect, it } from "vitest";
import { CHART_BACKGROUND, PALETTE, PALETTE_KEYS, TEXT, contrastRatio, goalColor, nextColor, textOn } from "../src/palette";

describe("goal palette", () => {
  it("has eight distinct colours", () => {
    expect(PALETTE_KEYS).toHaveLength(8);
    expect(new Set(Object.values(PALETTE)).size).toBe(8);
    for (const hex of Object.values(PALETTE)) expect(hex).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("computes WCAG contrast", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21);
    expect(contrastRatio("#777777", "#777777")).toBe(1);
  });

  it("labels every colour in dark text at 4.5:1 or more, since white is too faint", () => {
    for (const k of PALETTE_KEYS) {
      expect(textOn(k)).toBe(TEXT.dark);
      expect(contrastRatio(PALETTE[k], TEXT.dark)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(PALETTE[k], TEXT.white)).toBeLessThan(4.5);
    }
  });

  it("stands out at 3:1 on the dark chart surface", () => {
    for (const k of PALETTE_KEYS) expect(contrastRatio(PALETTE[k], CHART_BACKGROUND.dark)).toBeGreaterThanOrEqual(3);
  });

  it("stays visible on the light chart surface, below 3:1 so charts must name the goals", () => {
    for (const k of PALETTE_KEYS) {
      const c = contrastRatio(PALETTE[k], CHART_BACKGROUND.light);
      expect(c).toBeGreaterThanOrEqual(1.4);
      expect(c).toBeLessThan(3);
    }
  });

  it("gives a goal without a colour a stable one from its id", () => {
    expect(goalColor({ id: "career", color: "sky" })).toBe("sky");
    const pick = goalColor({ id: "career", color: "" });
    expect(PALETTE_KEYS).toContain(pick);
    expect(goalColor({ id: "career", color: "" })).toBe(pick);
  });

  it("gives a new goal the first colour no active goal uses", () => {
    expect(nextColor([])).toBe("rose");
    expect(nextColor([{ color: "rose", archived: false }, { color: "lime", archived: true }])).toBe("lime");
    const all = PALETTE_KEYS.map((color) => ({ color, archived: false }));
    expect(nextColor([...all, { color: "rose", archived: false }])).toBe("lime");
  });
});
