type DirectRuntimeHarness = "codex" | "claude-code"

export function directRuntimeFinishMetadata(input: {
  runId: string
  harness: DirectRuntimeHarness
  startedAtMs: number
  durationMs: number
}) {
  return {
    runId: input.runId,
    transport: `${input.harness}-runtime`,
    startedAt: input.startedAtMs,
    durationMs: input.durationMs,
  }
}
