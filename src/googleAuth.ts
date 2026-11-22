// Google sign-in through the Google Identity Services token client.
// The access token lives in memory only and lasts about an hour; it is never stored.

/** The web OAuth client of the Stoa Google Cloud project. Public by design; there is no client secret. */
export const CLIENT_ID = "7465722221-v8pt4cje7mv1q1t8de1vmug38n2m9sgt.apps.googleusercontent.com";

/** Access to the files Stoa created, nothing else in the user's Drive. */
export const SCOPE = "https://www.googleapis.com/auth/drive.file";

const GIS_SRC = "https://accounts.google.com/gsi/client";
/** A token this close to its expiry counts as expired. */
const EXPIRY_MARGIN_MS = 60_000;
/** Gives up on a token request whose popup never reports back. */
const REQUEST_TIMEOUT_MS = 120_000;

/** Signing in is needed: no token, it expired and could not be renewed, or access was refused. */
export class AuthError extends Error {}

interface TokenResponse {
  access_token?: string;
  expires_in?: number | string;
  error?: string;
  error_description?: string;
}

interface TokenClient {
  callback: (r: TokenResponse) => void;
  error_callback: (e: { type?: string; message?: string }) => void;
  requestAccessToken(options?: { prompt?: string; login_hint?: string }): void;
}

interface Gis {
  accounts: {
    oauth2: {
      initTokenClient(config: {
        client_id: string;
        scope: string;
        callback: (r: TokenResponse) => void;
        error_callback?: (e: { type?: string; message?: string }) => void;
      }): TokenClient;
      hasGrantedAllScopes(r: TokenResponse, scope: string): boolean;
    };
  };
}

declare global {
  interface Window {
    google?: Gis;
  }
}

let current: { token: string; expiresAt: number } | null = null;
let scriptLoad: Promise<Gis> | null = null;
let client: TokenClient | null = null;

/** Loads Google's sign-in script once; a failed load (offline) is retried on the next call. */
export function loadGis(): Promise<Gis> {
  if (window.google?.accounts?.oauth2) return Promise.resolve(window.google);
  scriptLoad ??= new Promise<Gis>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = GIS_SRC;
    script.async = true;
    script.onload = () => (window.google?.accounts?.oauth2 ? resolve(window.google) : reject(new Error("Google sign-in did not load")));
    script.onerror = () => {
      script.remove();
      reject(new TypeError("Failed to fetch Google sign-in"));
    };
    document.head.append(script);
  }).catch((e) => {
    scriptLoad = null;
    throw e;
  });
  return scriptLoad;
}

/** An access token request is in flight (its popup may be open); callers wait for it instead of opening another. */
let pending: Promise<string> | null = null;

function requestToken(gis: Gis, { interactive, hint }: { interactive: boolean; hint?: string }): Promise<string> {
  if (pending) return pending;
  client ??= gis.accounts.oauth2.initTokenClient({ client_id: CLIENT_ID, scope: SCOPE, callback: () => undefined });
  const tokenClient = client;
  const request = new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new AuthError("Google sign-in did not answer")), REQUEST_TIMEOUT_MS);
    tokenClient.callback = (r) => {
      clearTimeout(timeout);
      if (r.error || !r.access_token) return reject(new AuthError(r.error_description || r.error || "Sign-in failed"));
      if (!gis.accounts.oauth2.hasGrantedAllScopes(r, SCOPE)) return reject(new AuthError("Stoa needs access to its own files in Drive"));
      current = { token: r.access_token, expiresAt: Date.now() + Number(r.expires_in ?? 3600) * 1000 };
      resolve(r.access_token);
    };
    tokenClient.error_callback = (e) => {
      clearTimeout(timeout);
      reject(new AuthError(e.message || e.type || "Sign-in failed"));
    };
    tokenClient.requestAccessToken({ prompt: interactive && !hint ? "select_account" : "", ...(hint ? { login_hint: hint } : {}) });
  });
  pending = request;
  const clear = () => {
    if (pending === request) pending = null;
  };
  request.then(clear, clear);
  return request;
}

/**
 * A valid access token. Without one, asks Google for a new one: with `interactive` the popup may
 * show the account chooser and consent; without it, a renewal for `hint` that fails when the browser
 * blocks the popup or Google needs the user. Both failures throw AuthError.
 */
export async function getAccessToken({ interactive, hint }: { interactive: boolean; hint?: string }): Promise<string> {
  if (current && current.expiresAt - EXPIRY_MARGIN_MS > Date.now()) return current.token;
  if (pending) return pending;
  current = null;
  return requestToken(await loadGis(), { interactive, hint });
}

/** A tap renews a token that expires within this long, so the sync it starts does not run into the expiry. */
const TAP_RENEW_MARGIN_MS = 5 * 60_000;

/**
 * Whether a tap should ask Google for a new token: the user has an account, no request is already
 * running, and the token is missing (not yet fetched since the page opened) or expired or about to.
 */
export function shouldRenewOnTap(o: { hasAccount: boolean; expiresAt: number | null; now: number; requesting: boolean }): boolean {
  if (!o.hasAccount || o.requesting) return false;
  return o.expiresAt === null || o.expiresAt - TAP_RENEW_MARGIN_MS <= o.now;
}

/**
 * Call synchronously from a tap handler, before any await: browsers only let a popup open when the
 * tap itself opens it. Starts a silent renewal for `email` when the token needs one and never waits
 * for it or throws; a sync that follows waits for the request, and a failed one shows "Sign in again".
 * Needs Google's script already loaded (see `loadGis`), since loading it is asynchronous.
 */
export function renewOnTap(email: string | undefined): void {
  const gis = window.google?.accounts?.oauth2 ? window.google : null;
  if (!gis || !email) return;
  if (!shouldRenewOnTap({ hasAccount: true, expiresAt: current?.expiresAt ?? null, now: Date.now(), requesting: pending !== null })) return;
  try {
    requestToken(gis, { interactive: false, hint: email }).catch(() => undefined);
  } catch {
    /* the browser refused to open the popup; the sync that follows reports "Sign in again" */
  }
}

/**
 * Drops the token, after the API refused it or on sign-out. Consent stays with Google,
 * so the next sign-in needs no new consent.
 */
export function forgetToken(): void {
  current = null;
}
