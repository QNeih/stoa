import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/** Every file under `dir`, as paths relative to it with forward slashes, sorted. */
function listFiles(dir: string, prefix = ""): string[] {
  return readdirSync(join(dir, prefix), { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? listFiles(dir, `${prefix}${e.name}/`) : [`${prefix}${e.name}`]))
    .sort();
}

/**
 * Writes sw.js into the build output with the list of built files, so the app works offline after
 * the first load. The cache version hashes the names and contents of every built file, index.html
 * and the files from public/ included, so any change to what ships reaches installed phones.
 * Runs after the bundle is written, because index.html is not in the bundle before that.
 */
function serviceWorker(): Plugin {
  let outDir = "dist";
  return {
    name: "stoa-service-worker",
    apply: "build",
    configResolved(config) {
      outDir = config.build.outDir;
    },
    closeBundle() {
      const files = listFiles(outDir).filter((f) => f !== "sw.js");
      const hash = createHash("sha256");
      for (const f of files) hash.update(f).update("\0").update(readFileSync(join(outDir, f))).update("\0");
      const version = hash.digest("hex").slice(0, 12);
      const precache = ["./", ...files.filter((f) => f !== "index.html").map((f) => `./${f}`)];
      const source = readFileSync("sw/sw.js", "utf8")
        .replace("__VERSION__", version)
        .replace("__PRECACHE__", JSON.stringify(precache));
      writeFileSync(join(outDir, "sw.js"), source);
    },
  };
}

/**
 * Content Security Policy for the built app: only its own code and Google's sign-in script run,
 * and the only remotes it talks to are Google sign-in, the Drive API (www.googleapis.com) and the
 * Sheets API. Limits what injected content could do with the access token.
 * Build only, because the dev server injects inline scripts.
 */
const GSI = "https://accounts.google.com/gsi/";
/**
 * The <style> element Google's sign-in script inserts on load (styles for its button UI).
 * If Google changes it, the browser logs a blocked style; the token popup works without it.
 */
const GSI_INLINE_STYLE = "'sha256-88QphsXJQwxKP9xXR175ZSMzpaq6Swzj9u3QQ+G2Wig='";
const CSP = [
  "default-src 'self'",
  `script-src 'self' ${GSI}client`,
  `style-src 'self' ${GSI}style ${GSI_INLINE_STYLE}`,
  `frame-src ${GSI}`,
  "img-src 'self' data: blob:",
  `connect-src 'self' ${GSI} https://www.googleapis.com https://sheets.googleapis.com`,
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
