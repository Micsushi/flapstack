export type SpeechAudioResult = {
  audioBase64: string
  mimeType: string
}

type ActiveSpeech = {
  audio: HTMLAudioElement
  url: string
  onStopped?: () => void
}

let activeSpeech: ActiveSpeech | null = null
const listeners = new Set<() => void>()

export function subscribeManagedSpeech(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getManagedSpeechSnapshot() {
  return activeSpeech !== null
}

function notifyManagedSpeechChanged() {
  for (const listener of listeners) listener()
}

/** One active spoken utterance per renderer window. New playback preempts old playback. */
export async function playManagedSpeech(
  result: SpeechAudioResult,
  options: {
    rate?: number
    onEnded?: () => void
    onError?: () => void
    onStopped?: () => void
  } = {},
) {
  stopManagedSpeech()

  const url = URL.createObjectURL(base64ToBlob(result.audioBase64, result.mimeType))
  const audio = new Audio(url)
  const current = { audio, url, onStopped: options.onStopped }
  activeSpeech = current
  notifyManagedSpeechChanged()

  const finish = (callback?: () => void) => {
    if (activeSpeech !== current) return
    URL.revokeObjectURL(url)
    activeSpeech = null
    notifyManagedSpeechChanged()
    callback?.()
  }

  audio.onended = () => finish(options.onEnded)
  audio.onerror = () => finish(options.onError)
  audio.playbackRate = options.rate ?? 1
  try {
    await audio.play()
    // Some Chromium paths reset playbackRate while starting a new source.
    audio.playbackRate = options.rate ?? 1
  } catch (error) {
    finish(options.onError)
    throw error
  }
  return audio
}

export function stopManagedSpeech(audio?: HTMLAudioElement | null) {
  if (!activeSpeech || (audio && activeSpeech.audio !== audio)) return
  const current = activeSpeech
  current.audio.onended = null
  current.audio.onerror = null
  current.audio.pause()
  current.audio.removeAttribute("src")
  URL.revokeObjectURL(current.url)
  activeSpeech = null
  notifyManagedSpeechChanged()
  current.onStopped?.()
}

function base64ToBlob(base64: string, mimeType: string) {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return new Blob([bytes], { type: mimeType })
}
