export function getOwnedClaudeSessionId(params: {
  storedSessionId?: string | null
  requestedSessionId?: string | null
}): string | undefined {
  const storedSessionId = params.storedSessionId?.trim()
  return storedSessionId || undefined
}

export function buildClaudeSessionResumeOptions(params: {
  resumeSessionId?: string
  shouldForkResume: boolean
  forkResumeAtUuid?: string | null
  resumeAtUuid?: string | null
  isUsingOllama: boolean
}): Record<string, unknown> {
  if (!params.resumeSessionId) return {}

  return {
    resume: params.resumeSessionId,
    ...(params.shouldForkResume && params.forkResumeAtUuid && !params.isUsingOllama
      ? {
          resumeSessionAt: params.forkResumeAtUuid,
          forkSession: true,
        }
      : params.resumeAtUuid && !params.isUsingOllama
        ? { resumeSessionAt: params.resumeAtUuid }
        : {}),
  }
}

export function resetClaudeSessionOptionsForFreshRun(options: Record<string, unknown>): void {
  delete options.resume
  delete options.resumeSessionAt
  delete options.forkSession
  delete options.continue
}
