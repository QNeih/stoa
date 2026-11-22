import { describe, expect, it } from "vitest";
import { shouldRenewOnTap } from "../src/googleAuth";

const now = Date.parse("2026-11-22T10:00:00Z");
const base = { hasAccount: true, expiresAt: now + 30 * 60_000, now, requesting: false };

describe("renewing the sign-in on a tap", () => {
  it("leaves a token with plenty of time alone", () => {
    expect(shouldRenewOnTap(base)).toBe(false);
  });

  it("renews an expired token", () => {
    expect(shouldRenewOnTap({ ...base, expiresAt: now - 1000 })).toBe(true);
  });

  it("renews a token about to expire, so the sync after the tap does not run into it", () => {
    expect(shouldRenewOnTap({ ...base, expiresAt: now + 2 * 60_000 })).toBe(true);
  });

  it("renews when the page opened without a token", () => {
    expect(shouldRenewOnTap({ ...base, expiresAt: null })).toBe(true);
  });

  it("does nothing without an account", () => {
    expect(shouldRenewOnTap({ ...base, hasAccount: false, expiresAt: null })).toBe(false);
  });

  it("does not open a second request while one is running", () => {
    expect(shouldRenewOnTap({ ...base, expiresAt: null, requesting: true })).toBe(false);
  });
});
