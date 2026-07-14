export type VoiceHistoryInsertHandler = (text: string) => void

const targets = new Map<string, VoiceHistoryInsertHandler>()
let activeTargetKey: string | null = null

export function registerVoiceHistoryInsertTarget(
  key: string,
  handler: VoiceHistoryInsertHandler,
): () => void {
  targets.set(key, handler)
  activeTargetKey = key
  return () => {
    if (targets.get(key) === handler) targets.delete(key)
    if (activeTargetKey === key) activeTargetKey = Array.from(targets.keys()).at(-1) ?? null
  }
}

export function captureVoiceHistoryInsertTarget(): string | null {
  return activeTargetKey
}

export function insertVoiceHistoryIntoTarget(key: string, text: string): boolean {
  const handler = targets.get(key)
  if (!handler) return false
  handler(text)
  return true
}

export function clearVoiceHistoryInsertTargetsForTest(): void {
  targets.clear()
  activeTargetKey = null
}
