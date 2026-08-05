import { describe, expect, it, vi } from "vitest"
import {
  CLAUDE_PROVIDER_TO_CODEX_CONTRACT,
  CODEX_PROVIDER_TO_CLAUDE_CONTRACT,
  LOCAL_PROVIDER_TO_CODEX_CONTRACT,
  TranslatedRuntimeAdapterError,
  createTranslatedRuntimeAdapterPackFactory,
} from "../src/main/lib/agent-runtime/translated-adapter-pack"
import { RuntimeLaunchCoordinator } from "../src/main/lib/agent-runtime/launch-coordinator"
import { createAgentRuntimeRegistry } from "../src/main/lib/agent-runtime/registry"
import type {
  HarnessAdapter,
  ResolvedAgentRuntime,
  ResolvedRuntimeLaunch,
  RuntimeAdapterContext,
  RuntimeAdapterProbe,
  RuntimeAdapterSession,
} from "../src/shared/agent-runtime"

describe("translated Runtime adapter packs", () => {
  it("resolves an exact harness+Runtime pack without changing direct-native dispatch", () => {
    const directCodex = adapter("codex")
    const claudeProvider = adapter("claude-code")
    const translatedFactory = createTranslatedRuntimeAdapterPackFactory(
      CLAUDE_PROVIDER_TO_CODEX_CONTRACT,
      () => claudeProvider,
    )
    const registry = createAgentRuntimeRegistry([
      { runtime: "codex", harness: "codex", factory: () => directCodex },
      { runtime: "codex", harness: "claude-code", factory: translatedFactory },
    ])

    expect(registry.forNewLaunch("codex", "codex")).toBe(directCodex)
    expect(registry.forNewLaunch("codex", "claude-code")).not.toBe(directCodex)
    expect(registry.get("codex", "claude-code")?.runtime).toBe("codex")
  })

  it.each([CLAUDE_PROVIDER_TO_CODEX_CONTRACT, CODEX_PROVIDER_TO_CLAUDE_CONTRACT])(
    "publishes exact translated identity, capabilities, and losses for $id",
    async (descriptor) => {
      const provider = adapter(descriptor.providerRuntime)
      const pack = createTranslatedRuntimeAdapterPackFactory(descriptor, () => provider)()

      const probe = await pack.probe(descriptor.providerHarness)

      expect(probe).toMatchObject({
        runtime: descriptor.contractRuntime,
        harness: descriptor.providerHarness,
        available: true,
        capabilities: {
          composition: {
            runtimeMode: "translated",
            providerRuntime: descriptor.providerRuntime,
            adapterChain: [{ id: descriptor.id, version: descriptor.version }],
            capabilities: {
              toolLoop: "available",
              tools: "lossy",
              permissions: "available",
              structuredOutput: "available",
              cancellation: "available",
              reasoning: "lossy",
              sessionFork: "unavailable",
            },
            losses: expect.arrayContaining([
              expect.objectContaining({ code: "native-session-identity" }),
              expect.objectContaining({ code: "reasoning-semantics" }),
            ]),
          },
        },
      })
    },
  )

  it("declares the generic local pack's exact unsupported features", async () => {
    const seen: Array<{ operation: string; context: RuntimeAdapterContext; value?: unknown }> = []
    const provider = adapter("flapstack-native", seen)
    provider.probe = async () => {
      const probe = availableProbe("flapstack-native", "local")
      return {
        ...probe,
        capabilities: {
          ...probe.capabilities,
          execution: {
            ...probe.capabilities.execution!,
            structuredOutput: { supported: false, reason: "No local output-schema contract." },
          },
        },
      }
    }
    const pack = createTranslatedRuntimeAdapterPackFactory(
      LOCAL_PROVIDER_TO_CODEX_CONTRACT,
      () => provider,
    )()

    const probe = await pack.probe("local")

    expect(probe).toMatchObject({
      runtime: "codex",
      harness: "local",
      available: true,
      capabilities: {
        composition: {
          providerRuntime: "flapstack-native",
          capabilities: {
            toolLoop: "available",
            mcp: "unavailable",
            skills: "unavailable",
            hooks: "unavailable",
            sessionResume: "unavailable",
            attachments: "unavailable",
            reasoning: "unavailable",
            structuredOutput: "unavailable",
            cancellation: "available",
            recovery: "unavailable",
          },
        },
      },
    })

    const launch = translatedLaunch(probe)
    const unsupported = contextFor(launch)
    unsupported.outputSchema = { type: "object" }
    await expect(pack.startSession(unsupported)).rejects.toThrow(/structured output/i)
    expect(seen).toEqual([])
  })

  it("dispatches the generic local pack through the Flapstack Native provider adapter", async () => {
    const seen: Array<{ operation: string; context: RuntimeAdapterContext; value?: unknown }> = []
    const provider = adapter("flapstack-native", seen)
    provider.probe = async (harness) => {
      seen.push({
        operation: "probe",
        context: contextFor(nativeLaunch("flapstack-native", harness)),
      })
      const probe = availableProbe("flapstack-native", harness)
      return {
        ...probe,
        capabilities: {
          ...probe.capabilities,
          execution: {
            ...probe.capabilities.execution!,
            structuredOutput: { supported: false, reason: "No local output-schema contract." },
          },
        },
      }
    }
    const registry = createAgentRuntimeRegistry([
      {
        runtime: "codex",
        harness: "local",
        factory: createTranslatedRuntimeAdapterPackFactory(
          LOCAL_PROVIDER_TO_CODEX_CONTRACT,
          () => provider,
        ),
      },
    ])
    const probe = await registry.probe("codex", "local")
    const coordinator = new RuntimeLaunchCoordinator(registry, { persistIntent: vi.fn() })

    await coordinator.launch({
      runId: "local-translated-run",
      chatId: "local-chat",
      subChatId: "local-subchat",
      launch: translatedLaunch(probe),
      prompt: "Inspect locally.",
      instructions: "Use the reviewed Codex contract.",
      outputSchema: null,
    })

    expect(seen.find(({ operation }) => operation === "startTurn")).toMatchObject({
      context: {
        launch: { harness: "local", resolvedRuntime: "flapstack-native" },
        outputSchema: null,
      },
      value:
        "Use the reviewed Codex contract.\n\n--- USER REQUEST ---\nInspect locally.\n--- END USER REQUEST ---",
    })
  })

  it("preserves authority and translates prompt, schema, tools, and reasoning controls into the selected provider adapter", async () => {
    const seen: Array<{ operation: string; context: RuntimeAdapterContext; value?: unknown }> = []
    const provider = adapter("claude-code", seen)
    const registry = createAgentRuntimeRegistry([
      {
        runtime: "codex",
        harness: "claude-code",
        factory: createTranslatedRuntimeAdapterPackFactory(
          CLAUDE_PROVIDER_TO_CODEX_CONTRACT,
          () => provider,
        ),
      },
    ])
    const probe = await registry.probe("codex", "claude-code")
    const launch = translatedLaunch(probe)
    const pack = registry.forNewLaunch("codex", "claude-code")
    const coordinator = new RuntimeLaunchCoordinator(registry, { persistIntent: vi.fn() })

    await coordinator.launch({
      runId: "translated-run",
      chatId: "child-chat",
      subChatId: "child-subchat",
      launch,
      prompt: "Review this patch.",
      instructions: "Use the imported Codex contract context.",
      outputSchema: { type: "object", required: ["verdict"] },
    })

    const started = seen.find((entry) => entry.operation === "startTurn")!
    expect(started.context.launch).toMatchObject({
      harness: "claude-code",
      resolvedRuntime: "claude-code",
      model: "claude-sonnet",
      controls: launch.controls,
      permission: launch.permission,
    })
    expect(started.context.outputSchema).toEqual({ type: "object", required: ["verdict"] })
    expect(started.value).toBe(
      "Use the imported Codex contract context.\n\n--- USER REQUEST ---\nReview this patch.\n--- END USER REQUEST ---",
    )
    expect(seen.map((entry) => entry.operation)).toEqual([
      "probe",
      "startSession",
      "startTurn",
      "streamActivity",
      "complete",
      "cleanup",
    ])
    await expect(
      pack.requestPermission(contextFor(launch), {
        toolName: "provider-native-tool",
        toolInput: { path: "project/file.ts" },
      }),
    ).resolves.toEqual({ decision: "allow" })
    expect(seen.at(-1)).toMatchObject({
      operation: "requestPermission",
      context: {
        launch: {
          harness: "claude-code",
          resolvedRuntime: "claude-code",
          permission: launch.permission,
        },
      },
      value: {
        toolName: "provider-native-tool",
        toolInput: { path: "project/file.ts" },
      },
    })
  })

  it("rejects a launch whose immutable snapshot does not name the selected pack", async () => {
    const pack = createTranslatedRuntimeAdapterPackFactory(CLAUDE_PROVIDER_TO_CODEX_CONTRACT, () =>
      adapter("claude-code"),
    )()
    const launch = translatedLaunch(await pack.probe("claude-code"))
    delete launch.capabilities.composition

    await expect(pack.startSession(contextFor(launch))).rejects.toMatchObject({
      name: "TranslatedRuntimeAdapterError",
      operation: "startSession",
      cause: expect.objectContaining({ message: expect.stringMatching(/snapshot.*pack/i) }),
    })
  })

  it("fails closed when the provider probe cannot enforce the pack", async () => {
    const provider = adapter("codex")
    provider.probe = async (harness) => unavailableProbe("codex", harness, "No tool loop.")
    const pack = createTranslatedRuntimeAdapterPackFactory(
      CODEX_PROVIDER_TO_CLAUDE_CONTRACT,
      () => provider,
    )()

    await expect(pack.probe("codex")).resolves.toMatchObject({
      runtime: "claude-code",
      harness: "codex",
      available: false,
      capabilities: {
        composition: {
          runtimeMode: "translated",
          adapterChain: [{ id: "codex-provider-to-claude-contract", version: "1" }],
          capabilities: {
            toolLoop: "unavailable",
            structuredOutput: "unavailable",
          },
        },
      },
      reason: {
        code: "runtime-unavailable",
        runtime: "claude-code",
        harness: "codex",
      },
    })
  })

  it("normalizes provider errors while forwarding cancellation and recovery to the same adapter", async () => {
    const seen: Array<{ operation: string; context: RuntimeAdapterContext; value?: unknown }> = []
    const provider = adapter("codex", seen)
    const secret = "sk-proj-abcdefghijklmnopqrstuvwxyz0123456789"
    provider.startTurn = async () => {
      throw new Error(`provider dispatch failed ${secret}`)
    }
    const pack = createTranslatedRuntimeAdapterPackFactory(
      CODEX_PROVIDER_TO_CLAUDE_CONTRACT,
      () => provider,
    )()
    const context = contextFor(
      translatedLaunch(await pack.probe(CODEX_PROVIDER_TO_CLAUDE_CONTRACT.providerHarness)),
    )
    const session = await pack.startSession(context)

    const failure = await pack.startTurn(context, session, "go").catch((error: unknown) => error)
    expect(failure).toMatchObject({
      name: "TranslatedRuntimeAdapterError",
      packId: CODEX_PROVIDER_TO_CLAUDE_CONTRACT.id,
      operation: "startTurn",
      cause: expect.objectContaining({
        message: expect.stringContaining("provider dispatch failed"),
      }),
    } satisfies Partial<TranslatedRuntimeAdapterError>)
    expect(String((failure as Error).message)).not.toContain(secret)
    expect(String((failure as Error & { cause: Error }).cause.message)).not.toContain(secret)

    await pack.cancel(context, "stop")
    await expect(pack.reconcile(context)).resolves.toBe("completed")
    await pack.cleanup(context)
    expect(seen.filter((entry) => entry.operation === "cancel")).toHaveLength(1)
    expect(seen.filter((entry) => entry.operation === "reconcile")).toHaveLength(1)
    expect(seen.filter((entry) => entry.operation === "cleanup")).toHaveLength(1)
  })
})

function translatedLaunch(probe: RuntimeAdapterProbe): ResolvedRuntimeLaunch {
  return {
    schemaVersion: 1,
    harness: probe.harness,
    model: probe.harness === "claude-code" ? "claude-sonnet" : "gpt-5",
    requestedPreference: probe.runtime,
    preferenceSource: "chat",
    resolvedRuntime: probe.runtime,
    compatibility: {
      compatible: true,
      harness: probe.harness,
      runtime: probe.runtime,
      reason: null,
    },
    versions: probe.versions,
    capabilities: probe.capabilities,
    controls: {
      schemaVersion: 1,
      modelEffort: "high",
      serviceTier: "priority",
      modelThinking: true,
      reasoningDisplay: false,
      subagentActivity: true,
      hookDiagnostics: false,
    },
    permission: {
      mode: "custom",
      customPermissions: { projectWrite: true, shell: false, network: false },
    },
  }
}

function contextFor(launch: ResolvedRuntimeLaunch): RuntimeAdapterContext {
  return {
    runId: "translated-run",
    chatId: "child-chat",
    subChatId: "child-subchat",
    launch,
    instructions: null,
    outputSchema: null,
    signal: new AbortController().signal,
  }
}

function adapter(
  runtime: ResolvedAgentRuntime,
  seen: Array<{ operation: string; context: RuntimeAdapterContext; value?: unknown }> = [],
): HarnessAdapter {
  return {
    runtime,
    async probe(harness) {
      seen.push({ operation: "probe", context: contextFor(nativeLaunch(runtime, harness)) })
      return availableProbe(runtime, harness)
    },
    async startSession(context) {
      seen.push({ operation: "startSession", context })
      return { providerSessionId: "provider-session", providerThreadId: "provider-thread" }
    },
    async resumeSession(context, session) {
      seen.push({ operation: "resumeSession", context })
      return session
    },
    async startTurn(context, _session, prompt) {
      seen.push({ operation: "startTurn", context, value: prompt })
      return { providerTurnId: "provider-turn" }
    },
    async *streamActivity(context) {
      seen.push({ operation: "streamActivity", context })
    },
    async requestPermission(context, request) {
      seen.push({ operation: "requestPermission", context, value: request })
      return { decision: "allow" }
    },
    async requestInput(context, request) {
      seen.push({ operation: "requestInput", context, value: request })
      return { value: "answer" }
    },
    async cancel(context, reason) {
      seen.push({ operation: "cancel", context, value: reason })
    },
    async complete(context) {
      seen.push({ operation: "complete", context })
    },
    async reconcile(context) {
      seen.push({ operation: "reconcile", context })
      return "completed"
    },
    async cleanup(context) {
      seen.push({ operation: "cleanup", context })
    },
  }
}

function nativeLaunch(runtime: ResolvedAgentRuntime, harness: string): ResolvedRuntimeLaunch {
  return {
    ...translatedLaunch(availableProbe(runtime, harness)),
    requestedPreference: runtime,
  }
}

function availableProbe(runtime: ResolvedAgentRuntime, harness: string): RuntimeAdapterProbe {
  return {
    runtime,
    harness,
    available: true,
    versions: { adapterVersion: `${runtime}-adapter`, protocolVersion: `${runtime}-protocol` },
    capabilities: {
      schemaVersion: 1,
      status: "available",
      capturedAt: "2026-08-05T00:00:00.000Z",
      controls: {
        modelThinking: { supported: true, reason: null },
        reasoningDisplay: { supported: true, reason: null },
        subagentActivity: { supported: true, reason: null },
        hookDiagnostics: { supported: true, reason: null },
      },
      execution: {
        continuation: { supported: true, reason: null },
        delegation: { supported: true, reason: null },
        structuredOutput: { supported: true, reason: null },
        cancellation: { supported: true, reason: null },
      },
      limitations: [],
      unavailableReason: null,
    },
    reason: null,
  }
}

function unavailableProbe(
  runtime: ResolvedAgentRuntime,
  harness: string,
  message: string,
): RuntimeAdapterProbe {
  const reason = {
    code: "runtime-unavailable" as const,
    message,
    harness,
    runtime,
    repair: "Repair provider capability support.",
  }
  const probe = availableProbe(runtime, harness)
  return {
    ...probe,
    available: false,
    capabilities: {
      ...probe.capabilities,
      status: "unavailable",
      unavailableReason: reason,
      limitations: [message],
    },
    reason,
  }
}
