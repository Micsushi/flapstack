import { defineConfig } from "vitest/config"

export default defineConfig({
  plugins: [
    {
      name: "strip-node-shebang-on-windows",
      enforce: "pre",
      transform(code, id) {
        if (id.endsWith(".mjs") && code.startsWith("#!")) {
          return code.replace(/^#!.*\r?\n/, "")
        }
      },
    },
  ],
  test: {
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],
    setupFiles: ["tests/setup-beta-features.ts"],
    passWithNoTests: false,
    // Windows filesystem, Git worktree, and SQLite integration tests contend heavily
    // at Vitest's host-wide default. Four workers keeps their 20s behavioral deadlines
    // meaningful instead of turning resource starvation into nondeterministic failures.
    maxWorkers: process.platform === "win32" ? 4 : undefined,
    testTimeout: process.platform === "win32" ? 20_000 : 5_000,
  },
})
