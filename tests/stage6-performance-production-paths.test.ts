import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { EventEmitter } from "node:events"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  closeWatcher,
  exerciseProductShutdown,
  observeProductAgentCapacity,
  observeProductTerminalCapacity,
  runProductAgentLifecycle,
  runProductTerminalLifecycle,
} from "../src/main/lib/performance/product-controls"
import { STAGE6_REQUIRED_PRODUCT_SEAMS } from "../src/main/lib/performance/requirements"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("Stage 6 PF03 production-backed performance controls", () => {
  it("awaits the filesystem watcher close event before returning", async () => {
    const watcher = new EventEmitter() as EventEmitter & { close(): void }
    let closeRequested = false
    watcher.close = () => {
      closeRequested = true
      setImmediate(() => watcher.emit("close"))
    }

    await expect(closeWatcher(watcher as never)).resolves.toBeUndefined()
    expect(closeRequested).toBe(true)
  })

  it("runs readiness and cancellation through the Runtime launch coordinator", async () => {
    const completed = await runProductAgentLifecycle({ cancel: false })
    const cancelled = await runProductAgentLifecycle({ cancel: true })

    expect(completed.readyMilliseconds).toBeGreaterThanOrEqual(0)
    expect(completed.cancelled).toBe(false)
    expect(cancelled.readyMilliseconds).toBeGreaterThanOrEqual(0)
    expect(cancelled.cancelled).toBe(true)
  })

  it("observes live Runtime ownership at the requested agent capacity", async () => {
    await expect(observeProductAgentCapacity(3)).resolves.toBe(3)
  })

  it("starts and cleans up the product TerminalManager PTY path", async () => {
    const rootPath = temporaryRoot()
    const result = await runProductTerminalLifecycle({
      rootPath,
      id: "single-terminal",
    })

    expect(result.readyMilliseconds).toBeGreaterThanOrEqual(0)
    expect(result.liveSessions).toBe(1)
  })

  it("releases Windows PTY worker resources between terminal lifecycles", async () => {
    if (process.platform !== "win32") return
    const rootPath = temporaryRoot()

    await runProductTerminalLifecycle({ rootPath, id: "resource-release-first" })
    await new Promise((resolve) => setTimeout(resolve, 1_100))
    const afterFirst = windowsPtyResourceCount()

    await runProductTerminalLifecycle({ rootPath, id: "resource-release-second" })
    await new Promise((resolve) => setTimeout(resolve, 1_100))

    expect(windowsPtyResourceCount()).toBeLessThanOrEqual(afterFirst)
  })

  it("observes live PTY sessions at the requested terminal capacity", async () => {
    const rootPath = temporaryRoot()

    await expect(
      observeProductTerminalCapacity({ limit: 3, rootPath, id: "terminal-capacity" }),
    ).resolves.toBe(3)
  })

  it("drives app shutdown with owned Runtime, PTY, listener, timer, and database resources", async () => {
    const rootPath = temporaryRoot()
    const productBridgeListeners = process.listenerCount("stage6-performance-product-bridge")

    const result = await exerciseProductShutdown(rootPath)
    expect(result).toEqual({
      agentRuns: 1,
      terminalSessions: 1,
      ownedTerminalProcesses: expect.any(Number),
      survivingTerminalProcesses: 0,
    })
    if (process.platform === "win32") {
      expect(result.ownedTerminalProcesses).toBeGreaterThan(0)
    }
    expect(process.listenerCount("stage6-performance-product-bridge")).toBe(productBridgeListeners)
    expect(readdirSync(rootPath)).toEqual([])
  })

  it("does not benchmark generic Node children or SQLite-only soak work", () => {
    const adapters = readFileSync("src/main/lib/performance/product-adapters.ts", "utf8")

    expect(adapters).not.toContain("spawn(process.execPath")
    expect(adapters).not.toContain("const marker = () => undefined")
    expect(adapters).toContain("runBoundedProductControlCycle")
    expect(adapters).toContain("observeProductAgentCapacity")
    expect(adapters).toContain("observeProductTerminalCapacity")
  })

  it("binds PF03 evidence labels to the product controls that are actually observed", () => {
    expect(STAGE6_REQUIRED_PRODUCT_SEAMS).toMatchObject({
      "agent-start-latency": "RuntimeLaunchCoordinator:flapstack-native-test-control",
      "terminal-start-latency": "TerminalManager:createPerformanceTestControl",
      "cancel-latency": "RuntimeLaunchCoordinator.cancel",
      "cleanup-process-delta":
        "runAppShutdown:RuntimeLaunchCoordinator+TerminalManager-owned-PTY-PIDs",
      "concurrent-agent-capacity": "RuntimeLaunchCoordinator:activeRunIds",
      "concurrent-terminal-capacity": "TerminalManager:getSessionCountByWorkspaceId",
      "deterministic-soak-memory-growth":
        "bounded-product-soak:SQLite-loop+RuntimeLaunchCoordinator-cycles+TerminalManager-PTY-cycles",
      "deterministic-soak-resource-delta":
        "bounded-product-soak:SQLite-loop+RuntimeLaunchCoordinator-cycles+TerminalManager-PTY-cycles",
    })
  })
})

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "flapstack-pf03-product-"))
  roots.push(root)
  return root
}

function windowsPtyResourceCount(): number {
  return process
    .getActiveResourcesInfo()
    .filter((resource) => resource === "MessagePort" || resource === "PipeWrap").length
}
