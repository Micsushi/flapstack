import { describe, expect, it, vi } from "vitest"
import {
  installBeforeQuitShutdown,
  runAppShutdown,
  type BeforeQuitEvent,
} from "../src/main/lib/app-shutdown"

describe("application shutdown", () => {
  it("awaits provider persistence and service cleanup before closing SQLite last", async () => {
    const order: string[] = []
    const step = (name: string) => async () => {
      order.push(`${name}:start`)
      await Promise.resolve()
      order.push(`${name}:done`)
    }

    await runAppShutdown({
      persistProviderSessions: step("providers"),
      cancelPendingOAuth: step("oauth"),
      stopDevMcpServer: step("dev-mcp"),
      stopProductMcpBridge: step("product-mcp"),
      stopMobileBridge: step("mobile-bridge"),
      cleanupGitWatchers: step("watchers"),
      shutdownAnalytics: step("analytics"),
      closeDatabase: step("database"),
    })

    expect(order).toEqual([
      "providers:start",
      "providers:done",
      "oauth:start",
      "oauth:done",
      "dev-mcp:start",
      "dev-mcp:done",
      "product-mcp:start",
      "product-mcp:done",
      "mobile-bridge:start",
      "mobile-bridge:done",
      "watchers:start",
      "watchers:done",
      "analytics:start",
      "analytics:done",
      "database:start",
      "database:done",
    ])
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
        stopDevMcpServer: () => order.push("dev-mcp"),
        stopProductMcpBridge: () => order.push("product-mcp"),
        stopMobileBridge: () => order.push("mobile-bridge"),
        cleanupGitWatchers: () => order.push("watchers"),
        shutdownAnalytics: () => order.push("analytics"),
        closeDatabase: () => order.push("database"),
      }),
    ).rejects.toThrow(/shutdown was incomplete/)
    expect(order.at(-1)).toBe("database")
  })
})
