export type DevAgentInputRendererState = {
  parentChatId: string
  subChatId: string
  pendingRequestIds: string[]
  hydratedRequestIds: string[]
  expiredRequestIds: string[]
  dialogOpen: boolean
  hydrationError: string | null
  observedAt: number
}

const states = new Map<string, DevAgentInputRendererState>()

export function recordDevAgentInputRendererState(state: DevAgentInputRendererState): void {
  states.set(state.subChatId, state)
}

export function listDevAgentInputRendererStates(): DevAgentInputRendererState[] {
  return [...states.values()].sort((left, right) => right.observedAt - left.observedAt)
}
