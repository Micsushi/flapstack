export type SpeechAudioResult = {
  audioBase64: string
  mimeType: string
}

export type SpeechPlaybackPosition = {
  currentTime: number
  duration: number
  spokenText: string
}

type ActiveSpeech = {
  audio: HTMLAudioElement
  url: string
  onStopped?: () => void
}

let activeSpeech: ActiveSpeech | null = null
const listeners = new Set<() => void>()
const playbackPositions = new Map<string, SpeechPlaybackPosition>()

export function getSpeechPlaybackPosition(key: string): SpeechPlaybackPosition {
  return playbackPositions.get(key) ?? { currentTime: 0, duration: 0, spokenText: "" }
}

export function setSpeechPlaybackPosition(
  key: string,
  position: Partial<SpeechPlaybackPosition>,
): SpeechPlaybackPosition {
  const next = { ...getSpeechPlaybackPosition(key), ...position }
  playbackPositions.set(key, next)
  return next
}

export function getSpeechStartTime(
  position: Pick<SpeechPlaybackPosition, "currentTime" | "duration">,
) {
  const finished = position.duration > 0 && position.currentTime >= position.duration - 0.15
  return finished ? 0 : position.currentTime
}

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
    startTime?: number
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
  if ((options.startTime ?? 0) > 0) audio.currentTime = options.startTime!
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

export function getSpeechCursor(text: string, currentTime: number, duration: number) {
  const words = text.trim().split(/\s+/).filter(Boolean)
  if (!words.length) return { current: "", context: "", count: 0, wordProgress: 0 }
  const ratio = duration > 0 ? Math.min(1, Math.max(0, currentTime / duration)) : 0
  if (ratio <= 0) return { current: "", context: "", count: 0, wordProgress: 0 }

  // Letters take time to speak and punctuation adds audible pauses. Weighting
  // by both tracks generated speech much more closely than equal time per word.
  const weights = words.map((word) => {
    const spokenLength = word.replace(/[^\p{L}\p{N}]/gu, "").length || 1
    const pause = /[.!?]["')\]]*$/.test(word) ? 5 : /[,;:]["')\]]*$/.test(word) ? 2 : 0
    return spokenLength + pause
  })
  const target = ratio * weights.reduce((sum, weight) => sum + weight, 0)
  let elapsed = 0
  let previousElapsed = 0
  let index = words.length - 1
  for (let candidate = 0; candidate < weights.length; candidate += 1) {
    elapsed += weights[candidate]!
    if (target <= elapsed) {
      index = candidate
      break
    }
    previousElapsed = elapsed
  }
  const wordProgress =
    ratio >= 1 ? 1 : Math.min(1, Math.max(0, (target - previousElapsed) / weights[index]!))
  return {
    index,
    count: ratio >= 1 ? words.length : index + 1,
    wordProgress,
    current: words[index]!,
    context: words.slice(Math.max(0, index - 4), Math.min(words.length, index + 5)).join(" "),
  }
}

export function normalizeSpeechDisplayWord(word: string) {
  const normalized = word.match(/[\p{L}\p{N}'’-]+/u)?.[0]?.toLocaleLowerCase() ?? ""
  return (
    {
      utilize: "use",
      approximately: "about",
      therefore: "so",
      however: "but",
      commence: "start",
      terminate: "stop",
    }[normalized] ?? normalized
  )
}

export function getSpeechDisplayTokens(text: string, wordCount: number): string[] {
  const contractions: Record<string, string[]> = {
    "here's": ["here", "is"],
    "i've": ["i", "have"],
    "i'm": ["i", "am"],
    "i'll": ["i", "will"],
    "don't": ["do", "not"],
    "doesn't": ["does", "not"],
    "can't": ["cannot"],
    "won't": ["will", "not"],
    "shouldn't": ["should", "not"],
    "wouldn't": ["would", "not"],
    "couldn't": ["could", "not"],
  }
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, wordCount)
    .flatMap((word) => {
      const normalized = normalizeSpeechDisplayWord(word)
      return contractions[normalized] ?? [normalized]
    })
}

export function extendSpeechRangeThroughPunctuation(text: string, wordEnd: number) {
  const punctuation = text.slice(wordEnd).match(/^[\p{P}\p{S}]+/u)?.[0] ?? ""
  return wordEnd + punctuation.length
}

function base64ToBlob(base64: string, mimeType: string) {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return new Blob([bytes], { type: mimeType })
}
