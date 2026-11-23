import { describe, expect, it } from "vitest";
import { keepBoth, overlapping, overlappingIds, overlaps, replaceOverlapped, trimOverlapped } from "../src/overlap";
import type { SessionEntry, StoredEntry } from "../src/types";

const at = (time: string) => `2026-11-23T${time}:00+01:00`;
const session = (start: string, end: string, habit = "new"): SessionEntry => ({ type: "session", habit, task: "", start: at(start), end: at(end), note: "" });
const saved = (id: number, start: string, end: string): StoredEntry => ({ ...session(start, end, `h${id}`), id, uid: `u${id}`, day: "2026-11-23" });
const times = (s: SessionEntry) => [s.start.slice(11, 16), s.end.slice(11, 16)];

describe("overlaps", () => {
  it("counts shared time, not touching ends", () => {
    expect(overlaps(session("09:00", "10:00"), session("09:30", "11:00"))).toBe(true);
    expect(overlaps(session("09:00", "10:00"), session("10:00", "11:00"))).toBe(false);
    expect(overlaps(session("09:00", "12:00"), session("10:00", "11:00"))).toBe(true);
  });
});

describe("overlapping", () => {
  it("lists the saved entries a session overlaps, earliest first, leaving out the one being edited", () => {
    const entries = [saved(1, "10:30", "11:30"), saved(2, "08:00", "09:15"), saved(3, "12:00", "13:00"), saved(4, "09:00", "10:00")];
    expect(overlapping(entries, session("09:00", "11:00")).map((e) => e.id)).toEqual([2, 4, 1]);
    expect(overlapping(entries, session("09:00", "11:00"), 4).map((e) => e.id)).toEqual([2, 1]);
  });
});

describe("overlappingIds", () => {
  it("marks every saved entry that overlaps another, including one inside a long one", () => {
    const entries = [saved(1, "08:00", "12:00"), saved(2, "09:00", "09:30"), saved(3, "11:00", "11:15"), saved(4, "12:00", "13:00"), saved(5, "14:00", "15:00"), saved(6, "14:30", "16:00")];
    expect([...overlappingIds(entries)].sort()).toEqual([1, 2, 3, 5, 6]);
  });
});

describe("resolving an overlap", () => {
  const before = saved(1, "08:00", "09:30");
  const after = saved(2, "10:30", "12:00");

  it("keep both saves the session unchanged", () => {
    expect(keepBoth(session("09:00", "11:00"))).toEqual({ session: session("09:00", "11:00"), update: [], remove: [] });
  });

  it("replace deletes the overlapped entries", () => {
    expect(replaceOverlapped(session("09:00", "11:00"), [before, after])).toEqual({ session: session("09:00", "11:00"), update: [], remove: [1, 2] });
  });

  it("trim ends an earlier saved entry where the new one starts, and ends the new one where a later entry starts", () => {
    const fix = trimOverlapped(session("09:00", "11:00"), [before, after])!;
    expect(times(fix.session)).toEqual(["09:00", "10:30"]);
    expect(fix.update.map((u) => [u.id, ...times(u.entry)])).toEqual([[1, "08:00", "09:00"]]);
    expect(fix.update[0].entry).toEqual({ type: "session", habit: "h1", task: "", start: at("08:00"), end: at("09:00"), note: "" });
    expect(fix.remove).toEqual([]);
  });

  it("trim starts the new session where a saved one that starts with it ends", () => {
    const fix = trimOverlapped(session("09:00", "11:00"), [saved(3, "09:00", "09:45")])!;
    expect(times(fix.session)).toEqual(["09:45", "11:00"]);
    expect(fix.update).toEqual([]);
  });

  it("trim cuts a saved entry that runs past the new session at the new start", () => {
    const fix = trimOverlapped(session("09:00", "10:00"), [saved(4, "08:00", "12:00")])!;
    expect(times(fix.session)).toEqual(["09:00", "10:00"]);
    expect(fix.update.map((u) => times(u.entry))).toEqual([["08:00", "09:00"]]);
  });

  it("trim is not possible when a saved entry covers the new session from its start", () => {
    expect(trimOverlapped(session("09:00", "10:00"), [saved(5, "09:00", "10:30")])).toBeNull();
  });
});
