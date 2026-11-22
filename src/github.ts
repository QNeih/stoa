// Minimal GitHub contents API client for the data repo.

export interface Remote {
  token: string;
  /** "owner/name" */
  repo: string;
}

export interface RemoteFile {
  text: string;
  sha: string;
}

export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function encodeBase64(text: string): string {
  let bin = "";
  for (const b of new TextEncoder().encode(text)) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function decodeBase64(b64: string): string {
  const bin = atob(b64.replace(/\s/g, ""));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export class GitHub {
  constructor(
    private remote: Remote,
    private fetchFn: typeof fetch = (...a) => fetch(...a),
  ) {}

  private url(path: string): string {
    const p = path.split("/").map(encodeURIComponent).join("/");
    return `https://api.github.com/repos/${this.remote.repo}/contents/${p}`;
  }

  private async call(method: string, path: string, body?: unknown): Promise<Response> {
    const res = await this.fetchFn(this.url(path), {
      method,
      cache: "no-store",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.remote.token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok && res.status !== 404) {
      let detail = "";
      try {
        detail = ((await res.json()) as { message?: string }).message ?? "";
      } catch {
        /* body is not JSON */
      }
      throw new GitHubError(`GitHub ${method} ${path}: ${res.status} ${detail}`.trim(), res.status);
    }
    return res;
  }

  /** The file, or null when it does not exist. */
  async get(path: string): Promise<RemoteFile | null> {
    const res = await this.call("GET", path);
    if (res.status === 404) return null;
    const json = (await res.json()) as { content: string; sha: string };
    return { text: decodeBase64(json.content), sha: json.sha };
  }

  async put(path: string, text: string, sha: string | undefined, message: string): Promise<void> {
    const res = await this.call("PUT", path, { message, content: encodeBase64(text), ...(sha ? { sha } : {}) });
    if (res.status === 404) throw new GitHubError(`GitHub PUT ${path}: repo not found or token has no access`, 404);
  }

  /** File names in a folder; empty when the folder does not exist. */
  async list(path: string): Promise<string[]> {
    const res = await this.call("GET", path);
    if (res.status === 404) return [];
    const json = (await res.json()) as { name: string; type: string }[];
    return Array.isArray(json) ? json.filter((f) => f.type === "file").map((f) => f.name) : [];
  }
}
