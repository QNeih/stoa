import { describe, expect, it } from "vitest";
import { dayOf, parseJsonl, slugify, toJsonl } from "../src/logs";
import type { StoredEntry } from "../src/types";

describe("logs", () => {
  const stored: StoredEntry[] = [
    { id: 2, day: "2026-11-22", type: "counter", counter: "apps", at: "2026-11-22T11:00:00+01:00", delta: 1 },
    {
      id: 1,
      day: "2026-11-22",
      type: "session",
      habit: "gym",
      task: "Legs",
      start: "2026-11-22T09:00:00+01:00",
      end: "2026-11-22T10:00:00+01:00",
      note: "",
    },
  ];

  it("writes the contract fields only, one line per entry in time order", () => {
    const text = toJsonl(stored);
    expect(text).toBe(
      '{"type":"session","habit":"gym","task":"Legs","start":"2026-11-22T09:00:00+01:00","end":"2026-11-22T10:00:00+01:00","note":""}\n' +
        '{"type":"counter","counter":"apps","at":"2026-11-22T11:00:00+01:00","delta":1}\n',
    );
    expect(parseJsonl(text)).toHaveLength(2);
    expect(toJsonl([])).toBe("");
  });

  it("files a session under its local start date", () => {
    const e = {
      type: "session" as const,
      habit: "x",
      task: "",
      start: "2026-11-22T23:30:00+01:00",
      end: "2026-11-23T01:00:00+01:00",
      note: "",
    };
    expect(dayOf(e)).toBe("2026-11-22");
  });

  it("makes unique lowercase slugs", () => {
    expect(slugify("Educational content intake", [])).toBe("educational-content-intake");
    expect(slugify("Gym", ["gym"])).toBe("gym-2");
    expect(slugify("Lesen & Größe", [])).toBe("lesen-grosse");
  });
});
