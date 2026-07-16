import type { AgentRunLauncher } from "../run-launch-service"
import type { ResolvedAgentRuntime, RuntimeAdapterProbe } from "../../../shared/agent-runtime"

export type RuntimeLaunchAuthority = {
  launch: AgentRunLauncher
  cancel(runId: string, reason: string): Promise<boolean>
  probe(runtime: ResolvedAgentRuntime, harness: string): Promise<RuntimeAdapterProbe>
}

const authorities = new Map<string, RuntimeLaunchAuthority>()

export function registerRuntimeLaunchAuthority(
  databasePath: string,
  authority: RuntimeLaunchAuthority,
): void {
  authorities.set(databasePath, authority)
}

export function requireRuntimeLaunchAuthority(databasePath: string): RuntimeLaunchAuthority {
  const authority = authorities.get(databasePath)
  if (!authority) throw new Error("Central Runtime launch authority is not initialized.")
  return authority
}

export function resetRuntimeLaunchAuthoritiesForTests(): void {
  authorities.clear()
}
