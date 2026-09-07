import { classifyProviderLimitError } from "../../../../shared/provider-limit-error"

export type RunErrorPresentation = {
  title: string
  message: string
  technicalDetail: string | null
}

const LOCAL_LAUNCH_PERMISSION_PATTERN =
  /(?:spawn\b[^\r\n]{0,512}\b(?:eperm|eacces)\b|access is denied)/i
const AUTH_PATTERN = /(?:\b401\b|unauthori[sz]ed|authentication failed|sign[- ]?in required)/i

export function presentRunError(
  rawMessage: string | null | undefined,
  platform: "darwin" | "win32" | "linux" | "unknown" = "unknown",
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

  const limitKind = detail ? classifyProviderLimitError(detail) : null
  if (limitKind) {
    return {
      title: limitKind === "quota" ? "Usage limit reached" : "Provider rate limit",
      message:
        limitKind === "quota"
          ? "This provider reports a usage limit. Check account usage and reset details, or switch provider or account."
          : "This provider rejected the request with a rate limit. Check its retry or account-limit details before retrying.",
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
