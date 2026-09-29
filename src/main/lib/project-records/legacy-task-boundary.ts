import { projectRecordsEnabled } from "./mode"
// Canonical mode must not accept a second lifecycle through the legacy task DB.
// Legacy rows remain readable; app startup selects Records authority before opening data.
export function assertLegacyTaskTransitionAllowed(env = process.env): void {
  if (projectRecordsEnabled(env)) {
    throw new Error(
      "Project records owns task transitions. Use the shared board workflow action with its current revision and claim.",
    )
  }
}
