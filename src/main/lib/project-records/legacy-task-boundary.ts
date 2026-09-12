// Canonical mode must not accept a second lifecycle through the legacy task DB.
// Legacy rows remain readable; switching off the connection restores legacy mode.
export function assertLegacyTaskTransitionAllowed(env = process.env): void {
  if (env.FLAPSTACK_PROJECT_RECORDS_URL) {
    throw new Error(
      "Project records owns task transitions. Use the shared board workflow action with its current revision and claim.",
    )
  }
}
