import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const runtimeFiles = [
  "src/main/index.ts",
  "src/main/lib/trpc/routers/claude.ts",
  "src/preload/index.ts",
  "src/renderer/main.tsx",
  "src/renderer/features/agents/lib/ipc-chat-transport.ts",
]

describe("hosted telemetry safety", () => {
  it.each(runtimeFiles)("does not initialize or capture Sentry from %s", (file) => {
    const source = readFileSync(resolve(file), "utf8")

    expect(source).not.toContain('import("@sentry/electron')
    expect(source).not.toMatch(/\bSentry\.(?:init|captureException)\b/)
  })

  it("does not describe identified analytics as anonymous", () => {
    const source = readFileSync(
      resolve("src/renderer/components/dialogs/settings-tabs/agents-preferences-tab.tsx"),
      "utf8",
    )

    expect(source).not.toContain("sharing anonymous usage data")
  })

  it("does not ship a hosted renderer analytics client", () => {
    const source = readFileSync(resolve("src/renderer/lib/analytics.ts"), "utf8")

    expect(source).not.toContain('import("posthog-js")')
    expect(source).not.toContain("posthog.")
  })
})
