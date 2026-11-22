import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: {
    "@": fileURLToPath(new URL(".", import.meta.url)),
    "server-only": createRequire(import.meta.url).resolve("next/dist/compiled/server-only/empty.js"),
  } },
  esbuild: { jsx: "automatic" },
  test: { include: ["tests/**/*.test.{mjs,jsx}"], clearMocks: true },
});
