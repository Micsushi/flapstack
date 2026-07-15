import type {
  LocalModelCapabilities,
  LocalModelCatalogSnapshot,
  LocalModelEndpointValidation,
  LocalModelLimitation,
  LocalModelToolTier,
  LocalModelToolTierState,
} from "../../../shared/local-model-contract"
import {
  resolveLocalModelSelection,
  resolveLocalModelToolTiers,
  validateLocalModelEndpoint,
} from "../../../shared/local-model-contract"
import type { RunPermissionMode } from "../../../shared/harness-types"

export const LOCAL_MODEL_UI_RUNTIME = {
  chat: true,
  toolTiers: ["read", "project-write", "shell", "git", "network"] as const,
}

export type LocalModelUiPhase = "idle" | "refreshing" | "settled"

export type LocalModelUiState = {
  endpointDraft: string
  endpointValidation: LocalModelEndpointValidation
  phase: LocalModelUiPhase
  catalog: LocalModelCatalogSnapshot | null
  selectedModelId: string | null
  refreshError: string | null
}

export type LocalModelUiEvent =
  | { type: "endpoint-edited"; value: string }
  | { type: "refresh-started" }
  | { type: "refresh-succeeded"; catalog: LocalModelCatalogSnapshot }
  | { type: "refresh-failed"; message: string }
  | { type: "model-selected"; modelId: string | null }

export function createLocalModelUiState(input: {
  endpoint: string
  selectedModelId?: string | null
}): LocalModelUiState {
  return {
    endpointDraft: input.endpoint,
    endpointValidation: validateLocalModelEndpoint(input.endpoint),
    phase: "idle",
    catalog: null,
    selectedModelId: input.selectedModelId ?? null,
    refreshError: null,
  }
}

export function reduceLocalModelUiState(
  state: LocalModelUiState,
  event: LocalModelUiEvent,
): LocalModelUiState {
  switch (event.type) {
    case "endpoint-edited":
      return {
        ...state,
        endpointDraft: event.value,
        endpointValidation: validateLocalModelEndpoint(event.value),
        phase: "idle",
        catalog: null,
        refreshError: null,
      }
    case "refresh-started":
      if (!state.endpointValidation.valid) {
        return { ...state, phase: "settled", refreshError: state.endpointValidation.message }
      }
      return { ...state, phase: "refreshing", refreshError: null }
    case "refresh-succeeded":
      return { ...state, phase: "settled", catalog: event.catalog, refreshError: null }
    case "refresh-failed":
      return { ...state, phase: "settled", refreshError: event.message }
    case "model-selected":
      return { ...state, selectedModelId: event.modelId }
  }
}

export type LocalModelToolPreview = LocalModelToolTierState & {
  runtimeAvailable: boolean
  displayAvailable: boolean
  displayReason: string | null
}

export type LocalModelControlPreview = {
  selectedModelId: string | null
  modelFound: boolean
  canLaunch: boolean
  status: string
  capabilities: LocalModelCapabilities | null
  limitations: LocalModelLimitation[]
  toolTiers: LocalModelToolPreview[]
}

export function buildLocalModelControlPreview(input: {
  state: LocalModelUiState
  permissionMode: RunPermissionMode
  runtime: {
    chat: boolean
    toolTiers: readonly LocalModelToolTier[]
  }
}): LocalModelControlPreview {
  const { state } = input
  const model = state.catalog?.models.find(
    (entry) => entry.identity.modelId === state.selectedModelId,
  )

  if (!state.catalog) {
    return emptyPreview(
      state.selectedModelId,
      state.refreshError ??
        (state.phase === "refreshing"
          ? "Refreshing the local catalog…"
          : "Refresh to inspect models."),
    )
  }

  if (!state.selectedModelId) {
    return emptyPreview(null, "Choose a local model before launch.", state.catalog.limitations)
  }

  const selection = resolveLocalModelSelection(state.catalog, state.selectedModelId)
  if (!model) {
    return emptyPreview(state.selectedModelId, "The selected model is no longer in the catalog.", [
      ...state.catalog.limitations,
      ...selection.limitations,
    ])
  }

  const tiers = resolveLocalModelToolTiers(model.capabilities, input.permissionMode).map((tier) => {
    const runtimeAvailable =
      tier.tier === "chat" ? input.runtime.chat : input.runtime.toolTiers.includes(tier.tier)
    const displayAvailable = selection.runnable && tier.available && runtimeAvailable
    const displayReason =
      tier.limitation?.message ??
      (!runtimeAvailable
        ? tier.tier === "chat"
          ? "Local chat streaming is not available in this build."
          : `The ${tier.tier} tool runtime is not available in this build.`
        : !selection.runnable
          ? "The current catalog state cannot authorize a launch."
          : null)
    return { ...tier, runtimeAvailable, displayAvailable, displayReason }
  })

  const chat = tiers.find((tier) => tier.tier === "chat")
  const canLaunch = selection.runnable && chat?.displayAvailable === true
  return {
    selectedModelId: state.selectedModelId,
    modelFound: true,
    canLaunch,
    status: canLaunch
      ? "Ready for a local chat."
      : selection.runnable
        ? (chat?.displayReason ?? "Local launch is unavailable.")
        : (selection.limitations[0]?.message ?? "This model cannot launch."),
    capabilities: model.capabilities,
    limitations: [...state.catalog.limitations, ...model.limitations],
    toolTiers: tiers,
  }
}

function emptyPreview(
  selectedModelId: string | null,
  status: string,
  limitations: LocalModelLimitation[] = [],
): LocalModelControlPreview {
  return {
    selectedModelId,
    modelFound: false,
    canLaunch: false,
    status,
    capabilities: null,
    limitations,
    toolTiers: [],
  }
}

export function localModelCatalogStatus(state: LocalModelUiState): {
  label: string
  detail: string
  tone: "neutral" | "success" | "warning" | "danger"
} {
  if (state.phase === "refreshing") {
    return { label: "Refreshing", detail: "Checking Ollama and installed models.", tone: "neutral" }
  }
  if (state.refreshError) {
    return { label: "Refresh failed", detail: state.refreshError, tone: "danger" }
  }
  switch (state.catalog?.state) {
    case "ready":
      return {
        label: "Available",
        detail: `${state.catalog.models.length} installed model${state.catalog.models.length === 1 ? "" : "s"}.`,
        tone: "success",
      }
    case "empty":
      return {
        label: "No models",
        detail: "Ollama is available but its catalog is empty.",
        tone: "warning",
      }
    case "stale":
      return {
        label: "Stale catalog",
        detail: "Cached models are display-only until refresh succeeds.",
        tone: "warning",
      }
    case "unavailable":
      return {
        label: "Unavailable",
        detail: "Ollama is not reachable at this loopback endpoint.",
        tone: "danger",
      }
    case "error":
      return {
        label: "Endpoint error",
        detail: "Ollama returned an error or invalid response.",
        tone: "danger",
      }
    default:
      return {
        label: "Not checked",
        detail: "Refresh to check availability and installed models.",
        tone: "neutral",
      }
  }
}
