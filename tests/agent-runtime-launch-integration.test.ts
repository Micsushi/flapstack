import { describe, expect, it, vi } from "vitest"
import {
  MAX_PAUSED_RUNTIME_DELIVERIES,
  RuntimeLaunchCoordinator,
} from "../src/main/lib/agent-runtime/launch-coordinator"
import { createAgentRuntimeRegistry } from "../src/main/lib/agent-runtime/registry"
import type {
  HarnessAdapter,
  ResolvedAgentRuntime,
  ResolvedRuntimeLaunch,
  RuntimeAdapterContext,
  RuntimeAdapterSession,
} from "../src/shared/agent-runtime"

describe("Runtime launch coordinator", () => {
  it("overlaps inert session setup and still rejects dispatch when a required preimage fails", async () => {
    let reject!: (error: Error) => void
    let ready!: () => void
    const entered = new Promise<void>((resolve) => {
      ready = resolve
    })
    const workspace = new Promise<void>((_, decline) => {
      reject = decline
    })
    const value = adapter("codex", [])
    const dispatch = vi.fn()
    const coordinator = new RuntimeLaunchCoordinator(
      createAgentRuntimeRegistry([
        {
          runtime: "codex",
          factory: () => ({
            ...value,
            preparesSessionBeforeWorkspace: true,
            async startSession(context) {
              ready()
              await context.waitForWorkspace!()
              dispatch()
              return value.startSession(context)
            },
          }),
        },
      ]),
      { prepareWorkspace: () => workspace, persistIntent: () => {} },
    )
    const running = coordinator.launch({
      runId: "overlap",
      chatId: "chat",
      subChatId: "sub",
      launch: launch("codex", "codex"),
      prompt: "Use the project.",
    })
    await entered
    expect(dispatch).not.toHaveBeenCalled()
    reject(new Error("Invalid preimage"))
    await expect(running).rejects.toThrow("Invalid preimage")
    expect(dispatch).not.toHaveBeenCalled()
  })

  it("does not replay uncertain intent and rejects duplicate active launches", async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const registry = createAgentRuntimeRegistry([
      { runtime: "codex", factory: () => adapter("codex", [], gate) },
    ])
    const coordinator = new RuntimeLaunchCoordinator(registry, { persistIntent: vi.fn() })
    const request = {
      runId: "same-run",
      chatId: "chat",
      subChatId: "sub",
      launch: launch("codex", "codex"),
      prompt: "Once.",
    }
    const first = coordinator.launch(request)
    await Promise.resolve()
    await expect(coordinator.launch(request)).rejects.toThrow("already active")
    release()
    await first
  })

  it("makes concurrent cancellation idempotent and never completes after cancel", async () => {
    let streamStarted!: () => void
    let releaseStream!: () => void
    const started = new Promise<void>((resolve) => {
      streamStarted = resolve
    })
    const streamGate = new Promise<void>((resolve) => {
      releaseStream = resolve
    })
    const events: string[] = []
    const value = adapter("codex", events)
    value.streamActivity = async function* () {
      events.push("stream")
      streamStarted()
      await streamGate
    }
    value.cancel = vi.fn(async () => {
      events.push("cancel")
      releaseStream()
    })
    value.complete = vi.fn(async () => {
      events.push("complete")
    })
    const lifecycle: string[] = []
    const coordinator = new RuntimeLaunchCoordinator(
      createAgentRuntimeRegistry([{ runtime: "codex", factory: () => value }]),
      {
        persistIntent: vi.fn(),
        onLifecycle: (_request, state) => lifecycle.push(state),
      },
    )
    const running = coordinator.launch({
      runId: "cancel-race",
      chatId: "chat",
      subChatId: "sub",
      launch: launch("codex", "codex"),
      prompt: "Cancel once.",
    })
    await started

    await expect(
      Promise.all([
        coordinator.cancel("cancel-race", "operator"),
        coordinator.cancel("cancel-race", "operator"),
      ]),
    ).resolves.toEqual([true, true])
    await expect(running).rejects.toMatchObject({ name: "RuntimeLaunchCancelledError" })
    expect(value.cancel).toHaveBeenCalledTimes(1)
    expect(value.complete).not.toHaveBeenCalled()
    expect(lifecycle.filter((state) => state === "cancelled")).toHaveLength(1)
    expect(lifecycle).not.toContain("completed")
  })

  it("bounds paused delivery, serializes rapid controls, and reconciles as running", async () => {
    let firstReferenced!: () => void
    let releaseBurst!: () => void
    let reachedBound!: () => void
    const first = new Promise<void>((resolve) => {
      firstReferenced = resolve
    })
    const burstGate = new Promise<void>((resolve) => {
      releaseBurst = resolve
    })
    const bounded = new Promise<void>((resolve) => {
      reachedBound = resolve
    })
    let produced = 0
    const value = adapter("codex", [])
    value.streamActivity = async function* () {
      produced += 1
      yield "first"
      await burstGate
      for (let index = 0; index < MAX_PAUSED_RUNTIME_DELIVERIES * 2; index += 1) {
        produced += 1
        if (index === MAX_PAUSED_RUNTIME_DELIVERIES - 1) reachedBound()
        yield `buffered-${index}`
      }
    }
    const references: string[] = []
    const lifecycle: string[] = []
    const coordinator = new RuntimeLaunchCoordinator(
      createAgentRuntimeRegistry([{ runtime: "codex", factory: () => value }]),
      {
        persistIntent: vi.fn(),
        onLifecycle: (_request, state) => lifecycle.push(state),
        onActivityReference: (_request, activity) => {
          references.push(activity)
          if (activity === "first") firstReferenced()
        },
      },
    )
    const request = {
      runId: "bounded-pause",
      chatId: "chat",
      subChatId: "sub",
      launch: launch("codex", "codex"),
      prompt: "Bound delivery.",
    }
    const running = coordinator.launch(request)
    await first
    await expect(
      Promise.all([coordinator.pause(request.runId), coordinator.pause(request.runId)]),
    ).resolves.toEqual([true, false])
    await expect(coordinator.reconcile(request)).resolves.toBe("running")
    releaseBurst()
    await bounded
    await Promise.resolve()
    expect(produced).toBe(MAX_PAUSED_RUNTIME_DELIVERIES + 1)
    expect(references).toEqual(["first"])
    await expect(
      Promise.all([coordinator.resume(request.runId), coordinator.resume(request.runId)]),
    ).resolves.toEqual([true, false])
    await running
    expect(references).toHaveLength(MAX_PAUSED_RUNTIME_DELIVERIES * 2 + 1)
    expect(lifecycle.filter((state) => state === "paused")).toHaveLength(1)
    expect(lifecycle.filter((state) => state === "resumed")).toHaveLength(1)
  })

  it("cancels a paused delivery without releasing buffered activity", async () => {
    let firstReferenced!: () => void
    let releaseSecond!: () => void
    let secondProduced!: () => void
    const first = new Promise<void>((resolve) => {
      firstReferenced = resolve
    })
    const secondGate = new Promise<void>((resolve) => {
      releaseSecond = resolve
    })
    const second = new Promise<void>((resolve) => {
      secondProduced = resolve
    })
    const value = adapter("codex", [])
    value.streamActivity = async function* () {
      yield "first"
      await secondGate
      secondProduced()
      yield "second"
    }
    value.cancel = vi.fn(async () => undefined)
    const references: string[] = []
    const lifecycle: string[] = []
    const coordinator = new RuntimeLaunchCoordinator(
      createAgentRuntimeRegistry([{ runtime: "codex", factory: () => value }]),
      {
        persistIntent: vi.fn(),
        onLifecycle: (_request, state) => lifecycle.push(state),
        onActivityReference: (_request, activity) => {
          references.push(activity)
          if (activity === "first") firstReferenced()
        },
      },
    )
    const running = coordinator.launch({
      runId: "cancel-paused",
      chatId: "chat",
      subChatId: "sub",
      launch: launch("codex", "codex"),
      prompt: "Cancel pause.",
    })
    await first
    await expect(coordinator.pause("cancel-paused")).resolves.toBe(true)
    releaseSecond()
    await second
    await expect(coordinator.cancel("cancel-paused", "operator")).resolves.toBe(true)
    await expect(running).rejects.toMatchObject({ name: "RuntimeLaunchCancelledError" })
    await expect(coordinator.resume("cancel-paused")).resolves.toBe(false)
    expect(references).toEqual(["first"])
    expect(lifecycle).toContain("paused")
    expect(lifecycle).toContain("cancelled")
    expect(lifecycle).not.toContain("completed")
  })
})

function adapter(
  runtime: ResolvedAgentRuntime,
  order: string[],
  gate?: Promise<void>,
): HarnessAdapter<string> {
  return {
    runtime,
    async probe(harness) {
      order.push("probe")
      return availableProbe(runtime, harness)
    },
    async startSession() {
      order.push("start-session")
      return { providerSessionId: "session", providerThreadId: null }
    },
    async resumeSession(_context: RuntimeAdapterContext, session: RuntimeAdapterSession) {
      order.push("resume-session")
      return session
    },
    async startTurn() {
      order.push("start-turn")
      return { providerTurnId: "turn" }
    },
    async *streamActivity() {
      order.push("stream")
      await gate
      yield "first"
      yield "second"
    },
    async requestPermission() {},
    async requestInput() {},
    async cancel() {},
    async complete() {
      order.push("complete")
    },
    async reconcile() {
      return "completed"
    },
    async cleanup() {
      order.push("cleanup")
    },
  }
}

function availableProbe(runtime: ResolvedAgentRuntime, harness: string) {
  return {
    runtime,
    harness,
    available: true,
    versions: { adapterVersion: "1", protocolVersion: "1" },
    capabilities: {
      schemaVersion: 1 as const,
      status: "available" as const,
      capturedAt: "2026-07-14T00:00:00.000Z",
      controls: {
        modelThinking: { supported: true, reason: null },
        reasoningDisplay: { supported: true, reason: null },
        subagentActivity: { supported: true, reason: null },
        hookDiagnostics: { supported: true, reason: null },
      },
      limitations: [],
      unavailableReason: null,
    },
    reason: null,
  }
}

function launch(runtime: ResolvedAgentRuntime, harness: string): ResolvedRuntimeLaunch {
  return {
    schemaVersion: 1,
    harness,
    model: "model",
    requestedPreference: runtime,
    preferenceSource: "chat",
    resolvedRuntime: runtime,
    compatibility: { compatible: true, harness, runtime, reason: null },
    versions: { adapterVersion: "1", protocolVersion: "1" },
    capabilities: availableProbe(runtime, harness).capabilities,
    controls: {
      schemaVersion: 1,
      modelEffort: "high",
      modelThinking: true,
      reasoningDisplay: true,
      subagentActivity: true,
      hookDiagnostics: false,
    },
    permission: { mode: "read-only", customPermissions: null },
  }
}
