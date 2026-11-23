import { useAtom } from "jotai"
import { antigravityPermissions } from "../../../../shared/antigravity-permissions"
import type { RunPermissionMode } from "../../../../shared/harness-types"
import { trpc } from "../../../lib/trpc"
import { antigravityModelSelectionsAtom, antigravityNativeApprovalsAtom } from "../atoms"

export function antigravityPermissionIssue(harness: string, mode: RunPermissionMode) {
  if (harness !== "antigravity") return null
  const application = antigravityPermissions(mode)
  return application.applied ? null : application.reason
}

export function useAntigravityModelPicker(
  enabled: boolean,
  subChatId?: string,
  persistedModel?: string | null,
) {
  const [selections, setSelections] = useAtom(antigravityModelSelectionsAtom)
  const [nativeApprovals, setNativeApprovals] = useAtom(antigravityNativeApprovalsAtom)
  const catalog = trpc.agentRuntimeChat.antigravityModels.useQuery(undefined, {
    enabled,
    retry: false,
    staleTime: 5 * 60_000,
  })
  const models = catalog.data ?? []
  const selectedModelId = subChatId
    ? (selections[subChatId] ?? persistedModel)
    : (selections.draft ?? models[0]?.id)
  const selectedModel = models.find((model) => model.id === selectedModelId)
  // Antigravity advertises each effort as a separate model ID.
  const effortPattern = /^(.*) \((minimal|none|low|medium|high|xhigh|max|ultra)\)$/i
  const family = selectedModel && effortPattern.exec(selectedModel.name)
  const efforts = family
    ? models.flatMap((model) => {
        const match = effortPattern.exec(model.name)
        return match?.[1] === family[1] && match?.[2] ? [{ id: model.id, label: match[2] }] : []
      })
    : []
  const status =
    catalog.error?.message ??
    (catalog.isPending
      ? "Loading Gemini models…"
      : !models.length
        ? "Antigravity returned no models."
        : null)
  return {
    models,
    nativeApprovals,
    setNativeApprovals,
    selectedModelId,
    efforts,
    selectedEffort: family?.[2],
    canRetry: catalog.isError || (catalog.isSuccess && !models.length),
    label: selectedModel?.name ?? selectedModelId ?? "Choose Gemini model",
    status,
    modelIssue(id: string | null | undefined) {
      if (status) return status
      if (!id) return "Choose a Gemini model before sending."
      return models.some((model) => model.id === id)
        ? null
        : `Gemini model ${id} is unavailable. Choose another model.`
    },
    retry: () => void catalog.refetch(),
    onSelectModel(modelId: string) {
      setSelections((current) => ({
        ...current,
        draft: modelId,
        ...(subChatId ? { [subChatId]: modelId } : {}),
      }))
    },
  }
}
