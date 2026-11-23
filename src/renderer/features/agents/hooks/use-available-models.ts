import { useMemo } from "react"
import { useAtomValue } from "jotai"

import { showOfflineModeFeaturesAtom } from "../../../lib/atoms"
import { trpc } from "../../../lib/trpc"
import { CLAUDE_MODELS, type ClaudeEffortLevel } from "../lib/models"

type PickerModel = {
  id: string
  name: string
  version: string
  efforts?: readonly ClaudeEffortLevel[]
  contextWindow?: number
}

function canonicalId(id: string) {
  return id.replace(/-\d{8}$/, "")
}

export function useAvailableModels(enabled = true) {
  const utils = trpc.useUtils()
  const discovery = trpc.claudeCode.listModels.useQuery(undefined, {
    enabled,
    staleTime: 300_000,
    retry: false,
  })
  const models = useMemo<PickerModel[]>(() => {
    if (!discovery.data) return [...CLAUDE_MODELS]
    const result = new Map<string, PickerModel>()
    for (const row of discovery.data) {
      if (row.alias === "default") continue
      const known = CLAUDE_MODELS.find((model) => model.id === canonicalId(row.id))
      const id = known?.id ?? row.id
      const label = /^(.*?)\s+(\d+(?:\.\d+)*)$/.exec(row.label)
      result.set(id, {
        id,
        name: known?.name ?? label?.[1] ?? row.label,
        version: known?.version ?? label?.[2] ?? "",
        contextWindow: known?.contextWindow,
        efforts: row.efforts.filter((value): value is ClaudeEffortLevel =>
          ["low", "medium", "high", "xhigh", "max"].includes(value),
        ),
      })
    }
    // The native picker omits this pinned ID even when the authenticated endpoint serves it.
    const pinnedHaiku = CLAUDE_MODELS.find((model) => model.id === "claude-haiku-5-5")
    if (pinnedHaiku && !result.has(pinnedHaiku.id)) result.set(pinnedHaiku.id, pinnedHaiku)
    return [...result.values()]
  }, [discovery.data])
  function modelIssue(id: string | undefined) {
    if (discovery.isError) return "Claude could not load its models. Refresh the list to try again."
    if (!discovery.data) return null
    if (!id || !models.some((model) => model.id === id || model.id === canonicalId(id)))
      return `Claude model ${id || "(unset)"} is unavailable. Choose another model.`
    return null
  }
  const recommended = discovery.data?.find((row) => row.alias === "default")?.id
  const defaultModelId = models.find(
    (model) => model.id === recommended || (recommended && model.id === canonicalId(recommended)),
  )?.id
  async function verifyModel(id: string | undefined) {
    if (discovery.data || discovery.isError) return modelIssue(id)
    try {
      const live = await utils.claudeCode.listModels.fetch()
      if (
        id &&
        (id === "claude-haiku-5-5" ||
          live.some((row) => row.id === id || canonicalId(row.id) === id))
      )
        return null
      return "The selected Claude model is unavailable. Choose another model."
    } catch {
      return "Claude could not load its models. Refresh the list to try again."
    }
  }
  const shared = {
    models,
    modelIssue,
    verifyModel,
    defaultModelId,
    retry: () => void discovery.refetch(),
  }

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
      ...shared,
      ollamaModels: ollamaStatus?.ollama.models ?? [],
      recommendedModel: ollamaStatus?.ollama.recommendedModel,
      isOffline,
      hasOllama: true,
    }
  }

  return {
    ...shared,
    ollamaModels: [] as string[],
    recommendedModel: undefined as string | undefined,
    isOffline,
    hasOllama: false,
  }
}
