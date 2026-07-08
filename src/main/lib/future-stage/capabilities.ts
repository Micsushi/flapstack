import {
  futureStageCapabilities,
  futureStageIds,
  type FutureStageCapability,
  type FutureStageId,
} from "../../../shared/future-stage-types"

export function listFutureStageCapabilities(): FutureStageCapability[] {
  return futureStageCapabilities
}

export function getFutureStageCapability(id: FutureStageId): FutureStageCapability {
  const capability = futureStageCapabilities.find((item) => item.id === id)
  if (!capability) {
    throw new Error(`Unknown future stage capability: ${id}`)
  }
  return capability
}

export function isFutureStageId(value: string): value is FutureStageId {
  return (futureStageIds as readonly string[]).includes(value)
}
