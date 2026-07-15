import { createAppRouter } from "./trpc/routers"
import type { AgentRunLauncher, QueuedAgentRun } from "./run-launch-service"

/** Uses the same tRPC provider procedures as renderer-driven sends. */
export function createMainRunLauncher(): AgentRunLauncher {
  const caller = createAppRouter(() => null).createCaller({ getWindow: () => null })
  return async (run) => {
    const cwd = run.worktreePath ?? run.projectPath
    if (!cwd) throw new Error("Run has no project or worktree path.")
    let stream: unknown
    if (run.harness === "codex") {
      const model = resolveCodexLaunchModel(run.model, run.reasoningEffort)
      stream = await caller.codex.chat({
        runId: run.runId,
        chatId: run.chatId,
        subChatId: run.subChatId,
        prompt: run.prompt,
        cwd,
        ...(run.projectPath ? { projectPath: run.projectPath } : {}),
        ...(model ? { model } : {}),
        mode: "agent",
        reasoningEnabled: run.reasoningEffort !== "minimal",
        ...(run.reasoningEffort ? { reasoningEffort: run.reasoningEffort } : {}),
      })
    } else if (run.harness === "claude-code") {
      stream = await caller.claude.chat({
        runId: run.runId,
        chatId: run.chatId,
        subChatId: run.subChatId,
        prompt: run.prompt,
        cwd,
        ...(run.projectPath ? { projectPath: run.projectPath } : {}),
        ...(run.model ? { model: run.model } : {}),
        mode: "agent",
        reasoningEnabled: run.reasoningEffort !== "minimal",
        ...(run.reasoningEffort && run.reasoningEffort !== "minimal"
          ? { effort: run.reasoningEffort }
          : {}),
      })
    } else if (run.harness === "cursor-agent") {
      stream = await caller.cursor.chat({
        runId: run.runId,
        chatId: run.chatId,
        subChatId: run.subChatId,
        prompt: run.prompt,
        cwd,
        ...(run.projectPath ? { projectPath: run.projectPath } : {}),
        ...(run.model ? { model: run.model } : {}),
        reasoningEnabled: run.reasoningEffort !== "minimal",
      })
    } else {
      if (!run.model) throw new Error(`${run.harness} queued runs require an explicit model.`)
      const model = run.model.startsWith(`${run.harness}/`)
        ? run.model
        : `${run.harness}/${run.model}`
      stream = await caller.opencode.chat({
        runId: run.runId,
        chatId: run.chatId,
        subChatId: run.subChatId,
        provider: run.harness,
        model,
        prompt: run.prompt,
        cwd,
        ...(run.projectPath ? { projectPath: run.projectPath } : {}),
        reasoningEnabled: run.reasoningEffort !== "minimal",
        reasoningEffort: run.reasoningEffort ?? "high",
      })
    }
    await drainStream(stream, run)
  }
}

function resolveCodexLaunchModel(
  model: string | null,
  reasoningEffort: QueuedAgentRun["reasoningEffort"],
): string | null {
  const normalized = model?.trim()
  if (!normalized) return null
  const effort = reasoningEffort && reasoningEffort !== "minimal" ? reasoningEffort : "low"
  const withoutEffort = normalized
    .replace(/\/(?:minimal|low|medium|high|xhigh)$/i, "")
    .replace(/\[(?:minimal|low|medium|high|xhigh)\]$/i, "")
  if (withoutEffort.includes("/")) return normalized
  return `${withoutEffort}/${effort}`
}

async function drainStream(stream: unknown, run: QueuedAgentRun): Promise<void> {
  if (isAsyncIterable(stream)) {
    for await (const chunk of stream) assertNoProviderError(chunk, run)
    return
  }
  if (isSubscribable(stream)) {
    await new Promise<void>((resolve, reject) => {
      stream.subscribe({
        next: (chunk) => {
          try {
            assertNoProviderError(chunk, run)
          } catch (error) {
            reject(error)
          }
        },
        error: reject,
        complete: resolve,
      })
    })
    return
  }
  throw new Error("Harness launch did not return a stream.")
}

function assertNoProviderError(chunk: unknown, run: QueuedAgentRun): void {
  if (!chunk || typeof chunk !== "object") return
  const value = chunk as { type?: unknown; errorText?: unknown }
  if (value.type === "error" || value.type === "auth-error")
    throw new Error(
      typeof value.errorText === "string" ? value.errorText : `${run.harness} run failed to start.`,
    )
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return Boolean(
    value && typeof (value as AsyncIterable<unknown>)[Symbol.asyncIterator] === "function",
  )
}

function isSubscribable(value: unknown): value is {
  subscribe(observer: {
    next(value: unknown): void
    error(error: unknown): void
    complete(): void
  }): unknown
} {
  return Boolean(value && typeof (value as { subscribe?: unknown }).subscribe === "function")
}
