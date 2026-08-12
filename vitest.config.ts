import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@telic/protocol": fileURLToPath(
        new URL("./packages/protocol/src/index.ts", import.meta.url),
      ),
      "@telic/core": fileURLToPath(
        new URL("./packages/core/src/index.ts", import.meta.url),
      ),
      "@telic/context": fileURLToPath(
        new URL("./packages/context/src/index.ts", import.meta.url),
      ),
      "@telic/mcp": fileURLToPath(
        new URL("./packages/mcp/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    testTimeout: 15_000,
    include: [
      "packages/**/*.test.ts",
      "test/**/*.test.ts",
      "apps/**/*.test.ts",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      include: ["packages/*/src/**/*.ts"],
      exclude: [
        "packages/*/src/**/index.ts",
        "packages/*/src/**/*.d.ts",
        "packages/*/src/**/types.ts",
        "packages/cli/src/bin.ts",
        "packages/mcp/src/server.ts",
      ],
      thresholds: {
        lines: 85,
        functions: 85,
        statements: 85,
        branches: 75,
      },
    },
  },
});

