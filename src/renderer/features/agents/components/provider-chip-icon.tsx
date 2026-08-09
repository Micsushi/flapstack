import { Route, Sparkles, Zap } from "lucide-react"
import { ClaudeCodeIcon, CodexIcon, CursorIcon } from "../../../components/ui/icons"

export function hasProviderChipIcon(provider?: string | null): boolean {
  return ["claude-code", "codex", "cursor-agent", "openrouter", "nanogpt", "local"].includes(
    provider ?? "",
  )
}

export function ProviderChipIcon({
  provider,
  className,
}: {
  provider?: string | null
  className?: string
}) {
  switch (provider) {
    case "claude-code":
      return <ClaudeCodeIcon className={className} />
    case "codex":
      return <CodexIcon className={className} />
    case "cursor-agent":
      return <CursorIcon className={className} />
    case "openrouter":
      return <Route className={className} />
    case "nanogpt":
      return <Sparkles className={className} />
    case "local":
      return <Zap className={className} />
    default:
      return null
  }
}
