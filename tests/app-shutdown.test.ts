import { describe, expect, it } from "vitest"
import { runAppShutdown, waitForShutdownIdle } from "../src/main/lib/app-shutdown"
import { VisualCapturePendingStore } from "../src/main/lib/visual-capture/pending-store"

describe("application shutdown", () => {
  it("bounds waits for a provider that never becomes idle", async () => {
    let elapsed = 0
    await expect(
      waitForShutdownIdle({
        isIdle: () => false,
        timeoutMs: 25,
        pollMs: 10,
        now: () => elapsed,
        sleep: async (milliseconds) => {
          elapsed += milliseconds
        },
      }),
    ).resolves.toBe(false)
    expect(elapsed).toBe(25)
  })

  it("awaits provider persistence and service cleanup before closing SQLite last", async () => {
    const order: string[] = []
    const pending = new VisualCapturePendingStore(() => 1)
    const raw = Buffer.from("shutdown-owned raw capture")
    pending.add(pending.reserve(), {
      requestId: "request-a",
      sourceClass: "screen",
      bytes: raw,
      actor: { kind: "user", id: "owner" },
      scope: { projectId: "project-a" },
      approvalId: null,
      capturedAt: 1,
      scaleFactor: 1,
    })
    const step = (name: string) => async () => {
      order.push(`${name}:start`)
      await Promise.resolve()
      order.push(`${name}:done`)
    }

    await runAppShutdown({
      persistProviderSessions: step("providers"),
      cancelPendingOAuth: step("oauth"),
      stopAutomationScheduler: step("automations"),
      stopDevMcpServer: step("dev-mcp"),
      stopProductMcpBridge: step("product-mcp"),
      stopMobileBridge: step("mobile"),
      closeProjectVaultWatchers: step("project-vault-watchers"),
      purgePendingVisualCaptures: async () => {
        order.push("visual-captures:start")
        pending.shutdown()
        order.push("visual-captures:done")
      },
      cleanupGitWatchers: step("watchers"),
      shutdownAnalytics: step("analytics"),
      closeDatabase: step("database"),
    })

    expect(order).toEqual([
      "providers:start",
      "providers:done",
      "oauth:start",
      "oauth:done",
      "automations:start",
      "automations:done",
      "dev-mcp:start",
      "dev-mcp:done",
      "product-mcp:start",
      "product-mcp:done",
      "mobile:start",
      "mobile:done",
      "project-vault-watchers:start",
      "project-vault-watchers:done",
      "visual-captures:start",
      "visual-captures:done",
      "watchers:start",
      "watchers:done",
      "analytics:start",
      "analytics:done",
      "database:start",
      "database:done",
    ])
    expect(raw.equals(Buffer.alloc(raw.byteLength))).toBe(true)
  })
})
