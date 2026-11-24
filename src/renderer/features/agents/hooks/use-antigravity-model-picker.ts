import { antigravityEffortVariants } from "../../../../shared/antigravity-models"
import { useAtom } from "jotai"
import { antigravityPermissions } from "../../../../shared/antigravity-permissions"
import type { RunPermissionMode } from "../../../../shared/harness-types"
import { trpc } from "../../../lib/trpc"
import { antigravityEffortSelectionsAtom, antigravityModelSelectionsAtom } from "../atoms"

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
  const [effortChoices, setEffortChoices] = useAtom(antigravityEffortSelectionsAtom)
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
  const variants = antigravityEffortVariants(models, selectedModelId)
  const effortKey = (subChatId ?? "draft") + ":" + selectedModelId
  const storedEffort = effortChoices[effortKey]
  const nativeEffort = selectedModel?.nativeEfforts?.some(({ value }) => value === storedEffort)
    ? storedEffort
    : undefined
  const selectedEffort = nativeEffort ?? selectedModel?.defaultEffort ?? variants.selectedEffort
  const efforts = selectedModel?.nativeEfforts?.length
    ? selectedModel.nativeEfforts.map(({ value, name }) => ({
        id: value,
        label: name,
        selected: selectedEffort === value,
        onSelect: () => setEffortChoices((current) => ({ ...current, [effortKey]: value })),
      }))
    : variants.efforts.map((effort) => ({
        ...effort,
        selected: selectedModelId === effort.id,
        onSelect: () => onSelectModel(effort.id),
      }))
  function onSelectModel(modelId: string) {
    setSelections((current) => ({
      ...current,
      draft: modelId,
      ...(subChatId ? { [subChatId]: modelId } : {}),
    }))
  }
  const status =
    catalog.error?.message ??
    (catalog.isPending
      ? "Loading Antigravity models…"
      : !models.length
        ? "Antigravity returned no models."
        : null)
  return {
    models,
    selectedModelId,
    efforts,
    selectedEffort,
    nativeEffort,
    canRetry: catalog.isError || (catalog.isSuccess && !models.length),
    label: selectedModel?.name ?? selectedModelId ?? "Choose Antigravity model",
    status,
    modelIssue(id: string | null | undefined) {
      if (status) return status
      if (!id) return "Choose an Antigravity model before sending."
      return models.some((model) => model.id === id)
        ? null
        : `Gemini model ${id} is unavailable. Choose another model.`
    },
    retry: () => void catalog.refetch(),
    onSelectModel,
  }
}
