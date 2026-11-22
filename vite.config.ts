import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/** Emits sw.js with the list of built files, so the app works offline after the first load. */
function serviceWorker(): Plugin {
  return {
    name: "stoa-service-worker",
    apply: "build",
    generateBundle(_options, bundle) {
      const files = ["./", ...readdirSync("public"), ...Object.keys(bundle)]
        .filter((f) => f !== "index.html")
        .map((f) => (f.startsWith("./") ? f : `./${f}`));
      const version = createHash("sha256").update(files.join("\n")).digest("hex").slice(0, 12);
      const source = readFileSync("sw/sw.js", "utf8")
        .replace("__VERSION__", version)
        .replace("__PRECACHE__", JSON.stringify(files));
      this.emitFile({ type: "asset", fileName: "sw.js", source });
    },
  };
}

/**
 * Content Security Policy for the built app: only its own code runs, and the only
 * remote it talks to is the GitHub API. Limits what injected content could do with the token.
 * Build only, because the dev server injects inline scripts.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "connect-src 'self' https://api.github.com",
  "manifest-src 'self'",
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

function contentSecurityPolicy(): Plugin {
  return {
    name: "stoa-csp",
    apply: "build",
    transformIndexHtml: (html) =>
      html.replace("<head>", `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
  };
}

// Relative base so the build runs from any static host path.
export default defineConfig({
  base: "./",
  plugins: [react(), contentSecurityPolicy(), serviceWorker()],
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
});
