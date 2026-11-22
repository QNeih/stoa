import { defineConfig } from "vitest/config";

// Fixed zone with DST so midnight and offset handling are tested for real.
export default defineConfig({ test: { env: { TZ: "Europe/Berlin" } } });
