import { getMainRuntimeLaunchService } from "../main-run-launcher"
import type { QueuedAgentRun } from "../run-launch-service"
import { AutomationExecutionService } from "./execution"
import type { LeasedAutomationOccurrence } from "./scheduler"

export function createAutomationExecutionRuntime(databasePath: string): AutomationExecutionService {
  const runtimeLaunchService = getMainRuntimeLaunchService(databasePath)
  return new AutomationExecutionService(databasePath, {
    launch: runtimeLaunchService.launch,
    cancel: async (run) => {
      await runtimeLaunchService.cancel(run.runId, "automation-cancelled")
    },
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
