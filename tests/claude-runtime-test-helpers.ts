import type { ClaudeRuntimeDependencies } from "../src/main/lib/agent-runtime/claude-code"
import type { RuntimeAdapterContext } from "../src/shared/agent-runtime"

export function runtimeContext(): RuntimeAdapterContext {
  return {
    runId: "run-1",
    chatId: "chat-1",
    subChatId: "subchat-1",
    signal: new AbortController().signal,
    launch: {
      schemaVersion: 1,
      harness: "claude-code",
      model: "claude-fixture-model",
      requestedPreference: "claude-code",
      preferenceSource: "chat",
      resolvedRuntime: "claude-code",
      compatibility: {
        compatible: true,
        harness: "claude-code",
        runtime: "claude-code",
        reason: null,
      },
      versions: { adapterVersion: "1", protocolVersion: "claude-agent-sdk/0.3.207" },
      capabilities: {
        schemaVersion: 1,
        status: "available",
        capturedAt: "2026-07-14T12:00:00.000Z",
        controls: {
          modelThinking: { supported: true, reason: null },
          reasoningDisplay: { supported: true, reason: null },
          subagentActivity: { supported: true, reason: null },
          hookDiagnostics: { supported: true, reason: null },
        },
        limitations: [],
        unavailableReason: null,
      },
      controls: {
        schemaVersion: 1,
        modelEffort: "high",
        modelThinking: true,
        reasoningDisplay: true,
        subagentActivity: true,
        hookDiagnostics: true,
      },
      permission: { mode: "ask", customPermissions: null },
    },
  }
}

export function probeInput() {
  return {
    available: true,
    sdkVersion: "0.3.207",
    claudeCodeVersion: "2.1.207",
    features: {
      partialMessages: true,
      thinking: true,
      hooks: true,
      subagentForwarding: true,
      resume: true,
      resumeAt: true,
      fork: true,
      cancellation: true,
    },
  }
}

export function baseDependencies(
  overrides: Partial<ClaudeRuntimeDependencies> = {},
): ClaudeRuntimeDependencies {
  return {
    query: () => iterable([]),
    probe: async () => probeInput(),
    buildQueryOptions: () => ({ cwd: "PROJECT_ROOT" }),
    loadSession: async () => null,
    persistSession: async () => undefined,
    clearStaleSession: async () => undefined,
    appendActivity: async () => undefined,
    ...overrides,
  }
}

export async function* iterable<T>(values: readonly T[]): AsyncIterable<T> {
  for (const value of values) yield value
}

export async function collect<T>(values: AsyncIterable<T>): Promise<T[]> {
  const output: T[] = []
  for await (const value of values) output.push(value)
  return output
}
