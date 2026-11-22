import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Fixed zone with DST so midnight and offset handling are tested for real.
export default defineConfig({ plugins: [react()], test: { env: { TZ: "Europe/Berlin" } } });
