import { trpcClient } from "./trpc"
import { claimSpeechStream, playManagedSpeech, stopManagedSpeech } from "./speech-playback"
import { buildMessageSpeechRequest, type MessageSpeechRequestInput } from "./message-speech-request"

type Segment = { audioBase64: string; mimeType: string; start: number; duration: number }

export function streamReplySpeech(
  input: MessageSpeechRequestInput,
  options: {
    startTime: number
    getRate(): number
    onText(text: string): void
    onProgress(time: number, duration: number): void
    onPlaying(audio: HTMLAudioElement): void
    onFinish(): void
    onError(error: Error): void
    onHistoryError(error: string): void
  },
) {
  const segments: Segment[] = []
  let duration = 0
  let position = options.startTime
  let finished = false
  let stopped = false
  let playing = false
  let generation = 0
  let audio: HTMLAudioElement | null = null
  let artifactId: string | null = null
  let audible = false
  let subscription: { unsubscribe(): void } | undefined

  function markPlayed() {
    if (!artifactId || !audible) return
    const id = artifactId
    artifactId = null
    void trpcClient.speech.markPlayed.mutate({ id }).catch(() => {})
  }
  function stop() {
    if (stopped) return
    stopped = true
    generation++
    release()
    subscription?.unsubscribe()
    if (audio) stopManagedSpeech(audio)
    options.onFinish()
  }
  const release = claimSpeechStream(stop)
  function fail(error: Error) {
    if (stopped) return
    stop()
    options.onError(error)
  }

  function pump() {
    if (stopped || playing) return
    const segment = segments.find(
      (item) => item.duration === Infinity || item.start + item.duration > position + 0.001,
    )
    if (!segment) {
      if (finished) {
        options.onProgress(duration, duration)
        stop()
      }
      return
    }
    const current = ++generation
    playing = true
    const isCurrent = () => !stopped && generation === current
    void playManagedSpeech(segment, {
      streamOwner: stop,
      startTime: Math.max(0, position - segment.start),
      rate: options.getRate(),
      onEnded() {
        if (!isCurrent()) return
        position = segment.start + segment.duration
        audio = null
        playing = false
        options.onProgress(position, duration)
        pump()
      },
      onStopped() {
        if (isCurrent()) stop()
      },
      onError() {
        if (isCurrent()) fail(new Error("Could not play reply audio."))
      },
    })
      .then((element) => {
        if (!isCurrent()) return
        audio = element
        audible = true
        markPlayed()
        if (!Number.isFinite(segment.duration) && Number.isFinite(element.duration)) {
          segment.duration = element.duration
          duration = element.duration
        }
        const progress = () => {
          if (!isCurrent()) return
          if (finished && segments.length === 1 && Number.isFinite(element.duration)) {
            segment.duration = element.duration
            duration = element.duration
          }
          position = segment.start + element.currentTime
          options.onProgress(position, duration)
        }
        element.ontimeupdate = progress
        element.ondurationchange = progress
        options.onPlaying(element)
        progress()
      })
      .catch((error) => {
        if (isCurrent()) fail(error)
      })
  }

  subscription = trpcClient.speech.streamReply.subscribe(buildMessageSpeechRequest(input), {
    onData(event) {
      if (stopped) return
      if (event.spokenText) options.onText(event.spokenText)
      if (event.type === "chunk") {
        segments.push({ ...event, start: duration })
        duration += event.duration
      } else {
        finished = true
        artifactId = event.artifactId
        if (event.historyError) options.onHistoryError(event.historyError)
        if (event.audioBase64 && event.mimeType)
          segments.push({
            audioBase64: event.audioBase64,
            mimeType: event.mimeType,
            start: 0,
            duration: Infinity,
          })
        markPlayed()
      }
      pump()
    },
    onError: fail,
    onComplete() {
      if (!finished) stop()
    },
  })
  return {
    stop,
    seek(time: number) {
      generation++
      if (audio) stopManagedSpeech(audio)
      audio = null
      playing = false
      position = Math.min(time, duration)
      pump()
    },
  }
}
