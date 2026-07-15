let activeReaders = 0
let exclusivePending = false
let exclusiveActive = false
const drainWaiters = new Set<() => void>()

export function beginPortabilityReader(): () => void {
  if (exclusivePending || exclusiveActive)
    throw new Error("Portability maintenance is active; retry after it completes.")
  activeReaders += 1
  let released = false
  return () => {
    if (released) return
    released = true
    activeReaders -= 1
    if (activeReaders === 0) {
      for (const resolve of drainWaiters) resolve()
      drainWaiters.clear()
    }
  }
}

export async function beginExclusivePortabilityOperation(): Promise<() => void> {
  if (exclusivePending || exclusiveActive)
    throw new Error("Another portability maintenance operation is active.")
  exclusivePending = true
  if (activeReaders > 0) {
    await new Promise<void>((resolve) => drainWaiters.add(resolve))
  }
  exclusivePending = false
  exclusiveActive = true
  let released = false
  return () => {
    if (released) return
    released = true
    exclusiveActive = false
  }
}

export function getPortabilityOperationState(): {
  activeReaders: number
  exclusivePending: boolean
  exclusiveActive: boolean
} {
  return { activeReaders, exclusivePending, exclusiveActive }
}
