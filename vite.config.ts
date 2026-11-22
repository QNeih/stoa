import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
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

// Relative base so the build runs from any static host path.
export default defineConfig({
  base: "./",
  plugins: [serviceWorker()],
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
});
