import { fileURLToPath } from "node:url";

import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

/** Absolute path to a file in this repository. */
function here(path: string): string {
  return fileURLToPath(new URL(path, import.meta.url));
}

/**
 * Workspace packages resolve to source, not the dist their "exports" name, so
 * a test run never depends on a prior build or tests stale output.
 */
const alias = [
  {
    find: /^@maple-kit\/classifier$/,
    replacement: here("./packages/classifier/src/index.ts"),
  },
  { find: /^@maple-kit\/core$/, replacement: here("./packages/core/src/index.ts") },
  { find: /^@maple-kit\/core\/(.*)$/, replacement: here("./packages/core/src/$1/index.ts") },
  { find: /^@maple-kit\/mock$/, replacement: here("./packages/mock/src/index.ts") },
  { find: /^@maple-kit\/mock\/install$/, replacement: here("./packages/mock/src/install.ts") },
  { find: /^@maple-kit\/mock\/(.*)$/, replacement: here("./packages/mock/src/$1/index.ts") },
  { find: /^@maple-kit\/react$/, replacement: here("./packages/react/src/index.ts") },
  { find: /^@maple-kit\/react\/(.*)$/, replacement: here("./packages/react/src/$1/index.ts") },
  { find: /^@maple-kit\/ui$/, replacement: here("./packages/ui/src/index.ts") },
  { find: /^@maple-kit\/ui\/(.*)$/, replacement: here("./packages/ui/src/$1/index.ts") },
];

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "node",
          environment: "node",
          include: ["packages/*/test/**/*.test.ts", "tools/*/*.test.ts", "evals/**/*.eval.test.ts"],
          exclude: ["**/*.browser.test.ts", "**/*.browser.test.tsx"],
        },
      },
      {
        resolve: { alias },
        test: {
          name: "browser",
          include: ["packages/*/test/**/*.browser.test.{ts,tsx}"],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.ts"],
      exclude: ["packages/*/src/**/index.ts", "packages/*/src/testing/**"],
    },
  },
});
