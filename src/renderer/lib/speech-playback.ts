export type SpeechAudioResult = {
  audioBase64: string
  mimeType: string
}

type ActiveSpeech = { audio: HTMLAudioElement; url: string }

let activeSpeech: ActiveSpeech | null = null

/** One active spoken utterance per renderer window. New playback preempts old playback. */
export async function playManagedSpeech(
  result: SpeechAudioResult,
  options: { rate?: number; onEnded?: () => void; onError?: () => void } = {},
) {
  stopManagedSpeech()

  const url = URL.createObjectURL(base64ToBlob(result.audioBase64, result.mimeType))
  const audio = new Audio(url)
  const current = { audio, url }
  activeSpeech = current

  const finish = (callback?: () => void) => {
    if (activeSpeech === current) {
      URL.revokeObjectURL(url)
      activeSpeech = null
    }
    callback?.()
  }

  audio.onended = () => finish(options.onEnded)
  audio.onerror = () => finish(options.onError)
  await audio.play()
  audio.playbackRate = options.rate ?? 1
  return audio
}

export function stopManagedSpeech(audio?: HTMLAudioElement | null) {
  if (!activeSpeech || (audio && activeSpeech.audio !== audio)) return
  activeSpeech.audio.pause()
  activeSpeech.audio.removeAttribute("src")
  URL.revokeObjectURL(activeSpeech.url)
  activeSpeech = null
}

function base64ToBlob(base64: string, mimeType: string) {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return new Blob([bytes], { type: mimeType })
}
