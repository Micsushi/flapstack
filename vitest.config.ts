import { defineConfig } from "vitest/config"

const boundedHost = ["win32", "darwin"].includes(process.platform)

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
    // Native filesystem, Git worktree, child-process, and SQLite integration tests
    // contend heavily on Windows and macOS at Vitest's host-wide default.
    maxWorkers: boundedHost ? 4 : undefined,
    testTimeout: boundedHost ? 20_000 : 5_000,
  },
})
