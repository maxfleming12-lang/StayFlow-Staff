import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Vitest configuration.
 *
 * Only `src/**` is included so the runner never tries to execute the
 * documentation examples bundled inside node_modules.
 *
 * TZ is pinned to UTC to match the deployment host. Left unpinned, every
 * timezone assertion silently inherits the developer's machine clock — which
 * here is Australia/Sydney, the same zone the code is converting into, so a
 * conversion that ignored the property timezone entirely still passed.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "node",
    globals: false,
    env: { TZ: "UTC" },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});
