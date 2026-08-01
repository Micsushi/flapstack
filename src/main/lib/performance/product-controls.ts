import Database from "better-sqlite3"
import { randomUUID } from "node:crypto"
import { EventEmitter } from "node:events"
import { rmSync, watch, type FSWatcher } from "node:fs"
import { createServer, type Server } from "node:net"
import { join } from "node:path"
import { performance } from "node:perf_hooks"
import type { ResolvedRuntimeLaunch, RuntimeAdapterContext } from "../../../shared/agent-runtime"
import {
  RuntimeLaunchCancelledError,
  RuntimeLaunchCoordinator,
} from "../agent-runtime/launch-coordinator"
import { createAgentRuntimeRegistry } from "../agent-runtime/registry"
import {
  createFlapstackNativeAdapterFactory,
  type FlapstackNativeProviderDelegation,
} from "../agent-runtime/flapstack-native/adapter"
import {
  flapstackNativeCapabilitySnapshot,
  getFlapstackNativeDiagnostics,
} from "../agent-runtime/flapstack-native/provider-paths"
import { runAppShutdown } from "../app-shutdown"
import { TerminalManager, type TerminalCleanupResult } from "../terminal/manager"
import { VisualCapturePendingStore } from "../visual-capture/pending-store"

type AgentLaunchHandle = {
  runId: string
  readyMilliseconds: number
  completion: Promise<void>
}

type AgentLifecycleResult = {
  readyMilliseconds: number
  cancelled: boolean
  cancelMilliseconds: number | null
}

type TerminalLifecycleResult = {
  readyMilliseconds: number
  liveSessions: number
}

const PERFORMANCE_HARNESS = "generic"

class ProductAgentTestControl {
  private readonly heldRuns = new Set<string>()
  private readonly readiness = new Map<string, { resolve(): void; reject(error: unknown): void }>()
  private readonly active = new Map<string, AgentLaunchHandle>()
  private readonly coordinator: RuntimeLaunchCoordinator

  constructor() {
    const delegation = this.delegation()
    const factory = createFlapstackNativeAdapterFactory({
      resolveDelegation: () => delegation,
    })
    this.coordinator = new RuntimeLaunchCoordinator(
      createAgentRuntimeRegistry([{ runtime: "flapstack-native", factory }]),
      {
        persistIntent: () => undefined,
        onLifecycle: (request, lifecycle) => {
          if (lifecycle === "session-started") this.readiness.get(request.runId)?.resolve()
        },
      },
    )
  }

  async launch(hold: boolean): Promise<AgentLaunchHandle> {
    const runId = `performance-agent-${randomUUID()}`
    if (hold) this.heldRuns.add(runId)
    const startedAt = performance.now()
    const ready = new Promise<void>((resolve, reject) => {
      this.readiness.set(runId, { resolve, reject })
    })
    const launched = this.coordinator.launch({
      runId,
      chatId: `performance-chat-${runId}`,
      subChatId: null,
      launch: performanceLaunchSnapshot(),
      prompt: "Run the bounded Stage 6 performance test-control turn.",
    })
    launched.catch((error) => this.readiness.get(runId)?.reject(error))
    const completion = launched.then(() => undefined)
    try {
      await ready
      const handle = {
        runId,
        readyMilliseconds: Math.max(Number.EPSILON, performance.now() - startedAt),
        completion,
      }
      this.active.set(runId, handle)
      if (!hold) {
        await completion
        this.active.delete(runId)
      }
      return handle
    } finally {
      this.readiness.delete(runId)
      if (!hold) this.heldRuns.delete(runId)
    }
  }

  liveCount(): number {
    return this.coordinator.activeRunIds().length
  }

  async cancel(handle: AgentLaunchHandle): Promise<boolean> {
    const cancelled = await this.coordinator.cancel(handle.runId, "performance-test-control")
    try {
      await handle.completion
    } catch (error) {
      if (!(error instanceof RuntimeLaunchCancelledError)) throw error
    } finally {
      this.heldRuns.delete(handle.runId)
      this.active.delete(handle.runId)
    }
    return cancelled
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.active.values()].map((handle) => this.cancel(handle)))
  }

  private delegation(): FlapstackNativeProviderDelegation<never> {
    const heldRuns = this.heldRuns
    return {
      probe: () => ({ available: true }),
      async startSession(context) {
        return {
          providerSessionId: `performance-session-${context.runId}`,
          providerThreadId: null,
        }
      },
      async resumeSession(_context, session) {
        return session
      },
      async startTurn(context) {
        return { providerTurnId: `performance-turn-${context.runId}` }
      },
      streamActivity: (context) => this.controlledStream(context),
      async requestPermission() {
        throw new Error("Performance test-control turns do not request permission.")
      },
      async requestInput() {
        throw new Error("Performance test-control turns do not request input.")
      },
      async cancel() {},
      async complete() {},
      async reconcile(context) {
        return heldRuns.has(context.runId) ? "running" : "completed"
      },
      async cleanup() {},
    }
  }

  private async *controlledStream(context: RuntimeAdapterContext): AsyncIterable<never> {
    if (!this.heldRuns.has(context.runId)) return
    await waitForAbort(context.signal)
  }
}

export async function runProductAgentLifecycle(input: {
  cancel: boolean
}): Promise<AgentLifecycleResult> {
  const control = new ProductAgentTestControl()
  const handle = await control.launch(input.cancel)
  if (!input.cancel) {
    return {
      readyMilliseconds: handle.readyMilliseconds,
      cancelled: false,
      cancelMilliseconds: null,
    }
  }
  const cancelStartedAt = performance.now()
  const cancelled = await control.cancel(handle)
  return {
    readyMilliseconds: handle.readyMilliseconds,
    cancelled,
    cancelMilliseconds: Math.max(Number.EPSILON, performance.now() - cancelStartedAt),
  }
}

export async function observeProductAgentCapacity(limit: number): Promise<number> {
  assertPositiveLimit(limit)
  const control = new ProductAgentTestControl()
  try {
    await Promise.all(Array.from({ length: limit }, () => control.launch(true)))
    return control.liveCount()
  } finally {
    await control.stopAll()
  }
}

export async function runProductTerminalLifecycle(input: {
  rootPath: string
  id: string
}): Promise<TerminalLifecycleResult> {
  const manager = new TerminalManager()
  const workspaceId = `performance-terminal-${input.id}`
  const paneId = `${workspaceId}:term:0`
  const startedAt = performance.now()
  try {
    await manager.createPerformanceTestControl({
      paneId,
      workspaceId,
      scopeKey: `path:${input.rootPath}`,
      cwd: input.rootPath,
      cols: 80,
      rows: 24,
    })
    return {
      readyMilliseconds: Math.max(Number.EPSILON, performance.now() - startedAt),
      liveSessions: manager.getSessionCountByWorkspaceId(workspaceId),
    }
  } finally {
    await manager.cleanup()
  }
}

export async function observeProductTerminalCapacity(input: {
  limit: number
  rootPath: string
  id: string
}): Promise<number> {
  assertPositiveLimit(input.limit)
  const manager = new TerminalManager()
  const workspaceId = `performance-terminal-capacity-${input.id}`
  try {
    await Promise.all(
      Array.from({ length: input.limit }, (_, index) =>
        manager.createPerformanceTestControl({
          paneId: `${workspaceId}:term:${index}`,
          workspaceId,
          scopeKey: `path:${input.rootPath}`,
          cwd: input.rootPath,
          cols: 80,
          rows: 24,
        }),
      ),
    )
    return manager.getSessionCountByWorkspaceId(workspaceId)
  } finally {
    await manager.cleanup()
  }
}

export async function runBoundedProductControlCycle(input: {
  rootPath: string
  id: string
  includeTerminal: boolean
}): Promise<void> {
  await runProductAgentLifecycle({ cancel: false })
  if (input.includeTerminal) {
    await runProductTerminalLifecycle({ rootPath: input.rootPath, id: input.id })
  }
}

export async function exerciseProductShutdown(rootPath: string): Promise<{
  agentRuns: number
  terminalSessions: number
  ownedTerminalProcesses: number
  survivingTerminalProcesses: number
}> {
  const agentControl = new ProductAgentTestControl()
  const terminalManager = new TerminalManager()
  const workspaceId = `performance-shutdown-${randomUUID()}`
  const pendingCapture = new VisualCapturePendingStore(Date.now, { timeoutMs: 60_000 })
  const captureBytes = Buffer.from([1])
  const databasePath = join(rootPath, `performance-shutdown-${randomUUID()}.sqlite`)
  let database: Database.Database | null = null
  let projectVaultWatcher: FSWatcher | null = null
  let gitWatcher: FSWatcher | null = null
  let devMcpServer: Server | null = null
  let mobileBridgeServer: Server | null = null
  let terminalCleanupResult: TerminalCleanupResult = {
    ownedProcessIds: [],
    survivingProcessIds: [],
    ownershipComplete: false,
    ownershipIssues: ["Terminal cleanup has not run."],
  }
  let scheduler: ReturnType<typeof setInterval> | null = null
  const cancellation = new AbortController()
  const lifecycle = new EventEmitter()
  const lifecycleListener = () => undefined
  const productBridgeListener = () => undefined
  const productBridgeListenerCount = process.listenerCount("stage6-performance-product-bridge")
  try {
    const agent = await agentControl.launch(true)
    await terminalManager.createPerformanceTestControl({
      paneId: `${workspaceId}:term:0`,
      workspaceId,
      scopeKey: `path:${rootPath}`,
      cwd: rootPath,
    })
    const observed = {
      agentRuns: agentControl.liveCount(),
      terminalSessions: terminalManager.getSessionCountByWorkspaceId(workspaceId),
    }

    const reservation = pendingCapture.reserve()
    pendingCapture.add(reservation, {
      requestId: "performance-shutdown",
      sourceClass: "application-window",
      bytes: captureBytes,
      actor: { kind: "user", id: "performance-test-control" },
      scope: { projectId: "performance-project", chatId: "performance-chat" },
      approvalId: null,
      capturedAt: Date.now(),
      scaleFactor: 1,
    })
    database = new Database(databasePath)
    projectVaultWatcher = watch(rootPath, { persistent: false })
    gitWatcher = watch(rootPath, { persistent: false })
    devMcpServer = await listenLoopbackServer()
    mobileBridgeServer = await listenLoopbackServer()
    lifecycle.on("change", lifecycleListener)
    scheduler = setInterval(() => lifecycle.emit("change"), 60_000)
    scheduler.unref()
    process.on("stage6-performance-product-bridge", productBridgeListener)

    await runAppShutdown({
      persistProviderSessions: () => agentControl.cancel(agent).then(() => undefined),
      cancelPendingOAuth: () => cancellation.abort("performance-shutdown"),
      stopAutomationScheduler: () => {
        if (scheduler) clearInterval(scheduler)
        scheduler = null
      },
      stopDevMcpServer: async () => {
        await closeServer(devMcpServer)
        devMcpServer = null
      },
      stopProductMcpBridge: () => {
        process.off("stage6-performance-product-bridge", productBridgeListener)
      },
      stopMobileBridge: async () => {
        await closeServer(mobileBridgeServer)
        mobileBridgeServer = null
        terminalManager.detachAllListeners()
        terminalCleanupResult = await terminalManager.cleanupWithResult()
      },
      closeProjectVaultWatchers: async () => {
        const watcher = projectVaultWatcher
        projectVaultWatcher = null
        await closeWatcher(watcher)
      },
      purgePendingVisualCaptures: () => pendingCapture.shutdown(),
      cleanupGitWatchers: async () => {
        const watcher = gitWatcher
        gitWatcher = null
        await closeWatcher(watcher)
      },
      shutdownAnalytics: () => {
        lifecycle.off("change", lifecycleListener)
        lifecycle.removeAllListeners()
      },
      closeDatabase: () => {
        database?.close()
        database = null
      },
    })
    assertShutdownClean({
      agentRuns: agentControl.liveCount(),
      terminalSessions: terminalManager.getSessionCountByWorkspaceId(workspaceId),
      captureBytes,
      cancellation,
      lifecycle,
      productBridgeListenerCount,
      scheduler,
      projectVaultWatcher,
      gitWatcher,
      devMcpServer,
      mobileBridgeServer,
      database,
    })
    if (
      process.platform === "win32" &&
      (!terminalCleanupResult.ownershipComplete ||
        terminalCleanupResult.ownedProcessIds.length === 0)
    ) {
      throw new Error(
        `Terminal shutdown produced incomplete owned PID evidence: ${
          terminalCleanupResult.ownershipIssues.join("; ") || "no owned process IDs"
        }`,
      )
    }
    return {
      ...observed,
      ownedTerminalProcesses: terminalCleanupResult.ownedProcessIds.length,
      survivingTerminalProcesses: terminalCleanupResult.survivingProcessIds.length,
    }
  } finally {
    if (scheduler) clearInterval(scheduler)
    process.off("stage6-performance-product-bridge", productBridgeListener)
    lifecycle.removeAllListeners()
    await closeWatcher(projectVaultWatcher)
    await closeWatcher(gitWatcher)
    await closeServer(devMcpServer)
    await closeServer(mobileBridgeServer)
    pendingCapture.shutdown()
    database?.close()
    await agentControl.stopAll()
    await terminalManager.cleanupWithResult()
    rmSqliteFamily(databasePath)
  }
}

function performanceLaunchSnapshot(): ResolvedRuntimeLaunch {
  const diagnostics = getFlapstackNativeDiagnostics(PERFORMANCE_HARNESS)
  return {
    schemaVersion: 1,
    harness: PERFORMANCE_HARNESS,
    model: null,
    requestedPreference: "flapstack-native",
    preferenceSource: "legacy",
    resolvedRuntime: "flapstack-native",
    compatibility: {
      compatible: true,
      harness: PERFORMANCE_HARNESS,
      runtime: "flapstack-native",
      reason: null,
    },
    versions: diagnostics.versions,
    capabilities: flapstackNativeCapabilitySnapshot({
      harness: PERFORMANCE_HARNESS,
      available: true,
    }),
    controls: {
      schemaVersion: 1,
      modelEffort: null,
      serviceTier: null,
      modelThinking: null,
      reasoningDisplay: true,
      subagentActivity: false,
      hookDiagnostics: false,
    },
    permission: { mode: "read-only", customPermissions: null },
  }
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }))
}

function assertPositiveLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new Error("Performance product capacity requires a positive integer limit.")
  }
}

async function listenLoopbackServer(): Promise<Server> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening)
      reject(error)
    }
    const onListening = () => {
      server.off("error", onError)
      resolve()
    }
    server.once("error", onError)
    server.once("listening", onListening)
    server.listen({ host: "127.0.0.1", port: 0 })
  })
  server.unref()
  return server
}

async function closeServer(server: Server | null): Promise<void> {
  if (!server?.listening) return
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
}

export async function closeWatcher(watcher: FSWatcher | null): Promise<void> {
  if (!watcher) return
  await new Promise<void>((resolve, reject) => {
    const onClose = () => resolve()
    watcher.once("close", onClose)
    try {
      watcher.close()
    } catch (error) {
      watcher.off("close", onClose)
      reject(error)
    }
  })
}

function assertShutdownClean(input: {
  agentRuns: number
  terminalSessions: number
  captureBytes: Buffer
  cancellation: AbortController
  lifecycle: EventEmitter
  productBridgeListenerCount: number
  scheduler: ReturnType<typeof setInterval> | null
  projectVaultWatcher: FSWatcher | null
  gitWatcher: FSWatcher | null
  devMcpServer: Server | null
  mobileBridgeServer: Server | null
  database: Database.Database | null
}): void {
  const leaks: string[] = []
  if (input.agentRuns !== 0) leaks.push(`${input.agentRuns} Runtime run(s)`)
  if (input.terminalSessions !== 0) leaks.push(`${input.terminalSessions} PTY session(s)`)
  if (input.captureBytes.some((byte) => byte !== 0)) leaks.push("visual capture bytes")
  if (!input.cancellation.signal.aborted) leaks.push("pending OAuth cancellation")
  if (input.lifecycle.listenerCount("change") !== 0) leaks.push("lifecycle listener")
  if (
    process.listenerCount("stage6-performance-product-bridge") !== input.productBridgeListenerCount
  ) {
    leaks.push("product bridge listener")
  }
  if (input.scheduler) leaks.push("automation timer")
  if (input.projectVaultWatcher || input.gitWatcher) leaks.push("filesystem watcher")
  if (input.devMcpServer?.listening || input.mobileBridgeServer?.listening) {
    leaks.push("loopback server")
  }
  if (input.database?.open) leaks.push("SQLite handle")
  if (leaks.length > 0) {
    throw new Error(`Performance shutdown leaked ${leaks.join(", ")}.`)
  }
}

function rmSqliteFamily(path: string): void {
  for (const suffix of ["", "-shm", "-wal"]) {
    rmSync(`${path}${suffix}`, { force: true })
  }
}
