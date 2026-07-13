import { createAppRouter } from "./trpc/routers"
import type { AgentRunLauncher, QueuedAgentRun } from "./run-launch-service"

/** Uses the same tRPC provider procedures as renderer-driven sends. */
export function createMainRunLauncher(): AgentRunLauncher {
  const caller = createAppRouter(() => null).createCaller({ getWindow: () => null })
  return async (run) => {
    const cwd = run.worktreePath ?? run.projectPath
    if (!cwd) throw new Error("Run has no project or worktree path.")
    const stream =
      run.harness === "codex"
        ? await caller.codex.chat({
            runId: run.runId,
            chatId: run.chatId,
            subChatId: run.subChatId,
            prompt: run.prompt,
            cwd,
            ...(run.projectPath ? { projectPath: run.projectPath } : {}),
            ...(run.model ? { model: run.model } : {}),
            mode: "agent",
            reasoningEnabled: run.reasoningEffort !== "minimal",
            ...(run.reasoningEffort ? { reasoningEffort: run.reasoningEffort } : {}),
          })
        : await caller.claude.chat({
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
    await drainStream(stream, run)
  }
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
