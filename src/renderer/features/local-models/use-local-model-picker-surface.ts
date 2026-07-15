import { useAtom, useAtomValue } from "jotai"
import {
  DEFAULT_OLLAMA_BASE_URL,
  resolveLocalModelSelection,
  validateLocalModelEndpoint,
  type LocalModelCatalogState,
} from "../../../shared/local-model-contract"
import { localModelEndpointAtom, selectedLocalModelIdAtom } from "../../lib/atoms"
import { trpc } from "../../lib/trpc"

export function useLocalModelPickerSurface() {
  const endpoint = useAtomValue(localModelEndpointAtom)
  const [selectedModelId, setSelectedModelId] = useAtom(selectedLocalModelIdAtom)
  const validation = validateLocalModelEndpoint(endpoint)
  const queryEndpoint = validation.valid ? validation.endpoint : DEFAULT_OLLAMA_BASE_URL
  const { data: catalog } = trpc.localModels.catalog.useQuery(
    { endpoint: queryEndpoint },
    { enabled: false, retry: false, refetchOnWindowFocus: false },
  )
  const catalogState: LocalModelCatalogState | "not-checked" | "invalid-endpoint" =
    catalog?.state ?? (validation.valid ? "not-checked" : "invalid-endpoint")
  const selection = catalog ? resolveLocalModelSelection(catalog, selectedModelId ?? "") : null

  return {
    catalogState,
    selectedModelId,
    canLaunch: selection?.runnable === true,
    onSelectModel: setSelectedModelId,
    models:
      catalog?.models.map((model) => ({
        id: model.identity.modelId,
        name: model.identity.modelId,
        chat: model.capabilities.chat.state,
        tools: model.capabilities.tools.state,
        selectable: catalog.state === "ready" && model.capabilities.chat.state === "supported",
        limitations: model.limitations.map((limitation) => limitation.message),
      })) ?? [],
  }
}
