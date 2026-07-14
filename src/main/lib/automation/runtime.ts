import { createMainRunLauncher } from "../main-run-launcher"
import type { QueuedAgentRun } from "../run-launch-service"
import { cancelActiveClaudeSession } from "../trpc/routers/claude"
import { cancelActiveCodexRun } from "../trpc/routers/codex"
import { cancelActiveCursorRun } from "../trpc/routers/cursor"
import { cancelActiveOpencodeRun } from "../trpc/routers/opencode"
import { AutomationExecutionService } from "./execution"
import type { LeasedAutomationOccurrence } from "./scheduler"

export function createAutomationExecutionRuntime(databasePath: string): AutomationExecutionService {
  return new AutomationExecutionService(databasePath, {
    launch: createMainRunLauncher(),
    cancel: cancelAutomationRun,
  })
}

export function createAutomationExecutionDispatcher(
  databasePath: string,
): (occurrence: LeasedAutomationOccurrence) => Promise<void> {
  const execution = createAutomationExecutionRuntime(databasePath)
  return async (occurrence) => {
    await execution.execute(occurrence)
  }
}

function cancelAutomationRun(run: QueuedAgentRun): void {
  if (run.harness === "codex") {
    cancelActiveCodexRun(run)
  } else if (run.harness === "claude-code") {
    cancelActiveClaudeSession(run)
  } else if (run.harness === "cursor-agent") {
    cancelActiveCursorRun(run)
  } else if (run.harness === "openrouter" || run.harness === "nanogpt") {
    cancelActiveOpencodeRun(run)
  }
}
