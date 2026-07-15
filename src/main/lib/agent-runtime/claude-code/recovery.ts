import type { RuntimeAdapterSession, RuntimeAdapterContext } from "../../../../shared/agent-runtime"
import {
  buildClaudeSessionResumeOptions,
  resetClaudeSessionOptionsForFreshRun,
} from "../../claude/session-options"
import { isMissingClaudeSessionError } from "../../claude/session-recovery"
import type { ClaudeRuntimeResumeState } from "./types"

export function applyClaudeRuntimeResumeOptions(
  options: Record<string, unknown>,
  resume: ClaudeRuntimeResumeState | null,
): void {
  resetClaudeSessionOptionsForFreshRun(options)
  if (!resume) return
  Object.assign(
    options,
    buildClaudeSessionResumeOptions({
      resumeSessionId: resume.sessionId,
      shouldForkResume: resume.fork === true,
      forkResumeAtUuid: resume.fork ? resume.resumeAtUuid : null,
      resumeAtUuid: resume.fork ? null : resume.resumeAtUuid,
      isUsingOllama: false,
    }),
  )
}

export function shouldRetryClaudeRuntimeStaleSession(input: {
  error: unknown
  resume: ClaudeRuntimeResumeState | null
  deliveredProviderMessages: number
  retryUsed: boolean
  customDetector?: (error: unknown) => boolean
}): boolean {
  if (!input.resume || input.deliveredProviderMessages !== 0 || input.retryUsed) return false
  return (input.customDetector ?? isMissingClaudeSessionError)(input.error)
}

export function reconcileClaudeRuntimeUncertainty(input: {
  session: RuntimeAdapterSession
  turnStarted: boolean
  terminal: boolean
  cancelled: boolean
}): "running" | "completed" | "uncertain" {
  if (input.terminal || input.cancelled) return "completed"
  if (!input.turnStarted) return "completed"
  if (!input.session.providerSessionId) return "uncertain"
  return "uncertain"
}

export function createRuntimeSession(
  _context: RuntimeAdapterContext,
  resume: ClaudeRuntimeResumeState | null,
): RuntimeAdapterSession {
  return {
    providerSessionId: resume?.sessionId ?? null,
    providerThreadId: null,
  }
}
