export type RunErrorPresentation = {
  title: string
  message: string
  technicalDetail: string | null
}

const USAGE_LIMIT_PATTERN =
  /(?:\b429\b|insufficient[_ -]?quota|rate[_ -]?limit|usage limit|quota exceeded|out of (?:usage|credits)|too many requests)/i
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

  if (detail && USAGE_LIMIT_PATTERN.test(detail)) {
    return {
      title: "Usage limit reached",
      message:
        "This provider is temporarily rate-limited or out of usage. Wait for the reset, or switch provider or account.",
      technicalDetail: detail,
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
