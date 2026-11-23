import {
  classifyProviderLimitError,
  monthlySpendLimit,
  MONTHLY_SPEND_LIMIT_MESSAGE,
} from "../../../../shared/provider-limit-error"

export type RunErrorPresentation = {
  title: string
  message: string
  technicalDetail: string | null
}

const LOCAL_LAUNCH_PERMISSION_PATTERN =
  /(?:spawn\b[^\r\n]{0,512}\b(?:eperm|eacces)\b|access is denied)/i
const AUTH_PATTERN = /(?:\b401\b|unauthori[sz]ed|authentication failed|sign[- ]?in required)/i

export function shouldShowPersistedRunFailure(input: {
  run?: {
    id: string
    subChatId: string | null
    status: string
    promptMessageId: string | null
  } | null
  subChatId: string
  messages: readonly { id?: string; role?: string }[]
  status: string
  retryingRunId: string | null
}): boolean {
  if (input.status === "submitted" || input.status === "streaming") return false
  const latestUser = input.messages.findLast((message) => message.role === "user")
  return Boolean(
    input.run?.status === "failure" &&
    input.run.subChatId === input.subChatId &&
    input.run.promptMessageId &&
    input.run.promptMessageId === latestUser?.id &&
    input.run.id !== input.retryingRunId,
  )
}

export function presentRunError(
  rawMessage: string | null | undefined,
  platform: "darwin" | "win32" | "linux" | "unknown" = "unknown",
  persistedLimit?: "rate" | "quota" | "monthly-spend" | null,
): RunErrorPresentation {
  const detail = rawMessage?.trim()
  if (detail && LOCAL_LAUNCH_PERMISSION_PATTERN.test(detail)) {
    const message =
      platform === "win32"
        ? "Windows blocked Flapstack from starting the Codex App Server. This is a local launch or permissions problem, not a usage-limit error."
        : platform === "linux"
          ? "Linux blocked Flapstack from starting the Codex App Server. Check executable permissions and mount options, then retry."
          : "The operating system blocked Flapstack from starting the Codex App Server. Check local permissions, then retry."
    return {
      title: "Codex couldn’t start",
      message,
      technicalDetail: detail,
    }
  }

  if (persistedLimit === "monthly-spend" || (detail && monthlySpendLimit(detail)))
    return {
      title: "Monthly spend limit reached",
      message: MONTHLY_SPEND_LIMIT_MESSAGE,
      technicalDetail: null,
    }
  const limitKind = (detail ? classifyProviderLimitError(detail) : null) ?? persistedLimit
  if (limitKind) {
    return {
      title: limitKind === "quota" ? "Usage limit reached" : "Provider rate limit",
      message:
        limitKind === "quota"
          ? "Check your provider account for its next usage reset."
          : "The provider received too many requests. Try again later.",
      technicalDetail: detail ?? null,
    }
  }

  if (detail && AUTH_PATTERN.test(detail)) {
    return {
      title: "Sign-in required",
      message: "Sign in to this provider again, then retry the run.",
      technicalDetail: detail,
    }
  }

  return {
    title: "Run failed",
    message:
      detail ||
      "The provider stopped this run. Check usage, authentication, or the provider connection, then retry.",
    technicalDetail: null,
  }
}
