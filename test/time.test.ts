import { describe, expect, it } from "vitest";
import { daysBetween, formatDuration, isoLocal, localDate, splitByDay, startOfWeek } from "../src/time";

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
