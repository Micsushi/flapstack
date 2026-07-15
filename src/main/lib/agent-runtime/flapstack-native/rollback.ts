import type { AgentRuntimePreference } from "../../../../shared/agent-runtime"

export const FLAPSTACK_NATIVE_ROLLBACK_PRESERVES = [
  "runtime-snapshots",
  "activity-events",
  "chats",
  "runs",
  "messages",
  "provider-session-ids",
] as const

export type FlapstackNativeRollbackResult = {
  preference: "flapstack-native"
  changed: "runtime-default-only"
  deleted: readonly []
  preserved: typeof FLAPSTACK_NATIVE_ROLLBACK_PRESERVES
}

/**
 * Applies only an explicitly selected Runtime default. Data ownership remains
 * with existing persistence services; this helper has no delete/rewrite seam.
 */
export async function selectFlapstackNativeRollback(input: {
  explicitlySelected: boolean
  setPreference: (preference: AgentRuntimePreference) => Promise<void> | void
}): Promise<FlapstackNativeRollbackResult> {
  if (!input.explicitlySelected) {
    throw new Error("Flapstack Native rollback requires an explicit user selection.")
  }
  await input.setPreference("flapstack-native")
  return {
    preference: "flapstack-native",
    changed: "runtime-default-only",
    deleted: [],
    preserved: FLAPSTACK_NATIVE_ROLLBACK_PRESERVES,
  }
}
