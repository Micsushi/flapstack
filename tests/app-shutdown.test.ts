import { describe, expect, it, vi } from "vitest"
import {
  abortAndWaitForShutdownIdle,
  installBeforeQuitShutdown,
  runAppShutdown,
  waitForShutdownIdle,
  type BeforeQuitEvent,
} from "../src/main/lib/app-shutdown"
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

  it("returns as soon as shutdown becomes idle", async () => {
    let polls = 0
    await expect(
      waitForShutdownIdle({
        isIdle: () => ++polls >= 3,
        timeoutMs: 25,
        sleep: async () => undefined,
      }),
    ).resolves.toBe(true)
  })

  it("sends provider aborts before waiting on one combined idle predicate", async () => {
    const order: string[] = []
    let drainActive = true
    let providerActive = true

    await expect(
      abortAndWaitForShutdownIdle({
        abort: () => {
          order.push("abort")
          providerActive = false
        },
        isIdle: () => {
          order.push("poll")
          return !drainActive && !providerActive
        },
        timeoutMs: 25,
        sleep: async () => {
          drainActive = false
        },
      }),
    ).resolves.toBe(true)
    expect(order).toEqual(["abort", "poll", "poll"])
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

  it("prevents duplicate quits, runs one shutdown, and exits without another quit", async () => {
    let beforeQuit!: (event: BeforeQuitEvent) => void
    const app = {
      on: vi.fn((_event: "before-quit", listener: (event: BeforeQuitEvent) => void) => {
        beforeQuit = listener
      }),
      exit: vi.fn(),
    }
    let finishShutdown!: () => void
    const shutdown = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishShutdown = resolve
        }),
    )
    installBeforeQuitShutdown({ app, shutdown })
    const first = { preventDefault: vi.fn() }
    const duplicate = { preventDefault: vi.fn() }

    beforeQuit(first)
    beforeQuit(duplicate)

    expect(first.preventDefault).toHaveBeenCalledOnce()
    expect(duplicate.preventDefault).toHaveBeenCalledOnce()
    expect(shutdown).toHaveBeenCalledOnce()
    expect(app.exit).not.toHaveBeenCalled()

    finishShutdown()
    await vi.waitFor(() => expect(app.exit).toHaveBeenCalledWith(0))
    expect(shutdown).toHaveBeenCalledOnce()
  })

  it("still closes SQLite last when an earlier cleanup fails", async () => {
    const order: string[] = []
    await expect(
      runAppShutdown({
        persistProviderSessions: async () => {
          order.push("providers")
          throw new Error("provider cleanup failed")
        },
        cancelPendingOAuth: () => order.push("oauth"),
        stopAutomationScheduler: () => order.push("automations"),
        stopDevMcpServer: () => order.push("dev-mcp"),
        stopProductMcpBridge: () => order.push("product-mcp"),
        stopMobileBridge: () => order.push("mobile"),
        closeProjectVaultWatchers: () => order.push("project-vault-watchers"),
        purgePendingVisualCaptures: () => order.push("visual-captures"),
        cleanupGitWatchers: () => order.push("watchers"),
        shutdownAnalytics: () => order.push("analytics"),
        closeDatabase: () => order.push("database"),
      }),
    ).rejects.toThrow(/shutdown was incomplete/)
    expect(order.at(-1)).toBe("database")
  })
})
