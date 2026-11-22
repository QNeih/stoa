import { describe, expect, it } from "vitest";
import { daysBetween, formatDuration, isoLocal, localDate, splitByDay, startOfWeek, validateStart } from "../src/time";

describe("validateStart", () => {
  const now = new Date("2026-11-22T20:00:00+01:00");
  const at = (iso: string) => new Date(`2026-11-22T${iso}+01:00`);
  it("accepts a start 20 minutes back", () => {
    expect(validateStart(at("19:40:00"), now, null)).toBeNull();
    expect(validateStart(at("19:40:00"), now, at("19:00:00"))).toBeNull();
  });
  it("rejects a start in the future", () => {
    expect(validateStart(at("20:01:00"), now, null)).toMatch(/future/);
  });
  it("rejects a start more than 24 hours back and accepts exactly 24", () => {
    expect(validateStart(new Date("2026-11-21T19:59:00+01:00"), now, null)).toMatch(/24 hours/);
    expect(validateStart(new Date("2026-11-21T20:00:00+01:00"), now, null)).toBeNull();
  });
  it("rejects a start before the last session ended and names that time", () => {
    expect(validateStart(at("18:50:00"), now, at("19:00:00"))).toMatch(/before 19:00/);
    expect(validateStart(at("19:00:00"), now, at("19:00:00"))).toBeNull();
  });
  it("rejects an invalid date", () => {
    expect(validateStart(new Date("nope"), now, null)).toMatch(/valid/);
  });
});

describe("time", () => {
  it("writes ISO times with the local offset", () => {
    expect(isoLocal(new Date("2026-11-22T20:05:00Z"))).toBe("2026-11-22T21:05:00+01:00");
    expect(isoLocal(new Date("2026-07-01T10:00:00Z"))).toBe("2026-07-01T12:00:00+02:00");
  });

  it("splits a session that crosses midnight to both days", () => {
    const parts = splitByDay(new Date("2026-11-22T22:00:00+01:00"), new Date("2026-11-23T08:30:00+01:00"));
    expect(parts).toEqual([
      { day: "2026-11-22", ms: 2 * 3600_000 },
      { day: "2026-11-23", ms: 8.5 * 3600_000 },
    ]);
  });

  it("splits across several days and keeps a same-day session whole", () => {
    const days = splitByDay(new Date("2026-11-20T23:00:00+01:00"), new Date("2026-11-22T01:00:00+01:00")).map((p) => p.day);
    expect(days).toEqual(["2026-11-20", "2026-11-21", "2026-11-22"]);
    expect(splitByDay(new Date("2026-11-22T09:00:00+01:00"), new Date("2026-11-22T10:00:00+01:00"))).toHaveLength(1);
  });

  it("splits correctly on a DST night (23-hour day)", () => {
    const parts = splitByDay(new Date("2026-03-28T22:00:00+01:00"), new Date("2026-03-30T02:00:00+02:00"));
    expect(parts.map((p) => p.ms / 3600_000)).toEqual([2, 23, 2]);
  });

  it("starts the week on Monday and counts calendar days", () => {
    expect(localDate(startOfWeek(new Date("2026-11-22T12:00:00+01:00")))).toBe("2026-11-16");
    expect(daysBetween("2026-11-20", "2026-11-22")).toBe(2);
    expect(daysBetween("2026-03-28", "2026-03-30")).toBe(2);
  });

  it("formats durations", () => {
    expect(formatDuration(65 * 60_000)).toBe("1h 05m");
    expect(formatDuration(59_999)).toBe("0m");
  });
});
