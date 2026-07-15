import { useAtomValue } from "jotai"

import { showOfflineModeFeaturesAtom } from "../../../lib/atoms"
import { trpc } from "../../../lib/trpc"
import { CLAUDE_MODELS } from "../lib/models"

export function useAvailableModels() {
  const showOfflineFeatures = useAtomValue(showOfflineModeFeaturesAtom)
  const { data: ollamaStatus } = trpc.ollama.getStatus.useQuery(undefined, {
    refetchInterval: showOfflineFeatures ? 30000 : false,
    enabled: showOfflineFeatures,
  })

  const isOffline = ollamaStatus ? !ollamaStatus.internet.online : false
  const hasOllama =
    Boolean(ollamaStatus?.ollama.available) && (ollamaStatus?.ollama.models?.length ?? 0) > 0

  if (showOfflineFeatures && hasOllama && isOffline) {
    return {
      models: CLAUDE_MODELS,
      ollamaModels: ollamaStatus?.ollama.models ?? [],
      recommendedModel: ollamaStatus?.ollama.recommendedModel,
      isOffline,
      hasOllama: true,
    }
  }

  return {
    models: CLAUDE_MODELS,
    ollamaModels: [] as string[],
    recommendedModel: undefined as string | undefined,
    isOffline,
    hasOllama: false,
  }
}
