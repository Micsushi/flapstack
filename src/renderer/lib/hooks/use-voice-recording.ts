import { useState, useRef, useCallback, useEffect } from "react"

interface UseVoiceRecordingReturn {
  isRecording: boolean
  error: Error | null
  audioLevel: number // 0-1 normalized audio level
  startRecording: () => Promise<void>
  stopRecording: () => Promise<Blob>
  cancelRecording: () => void
}

/**
 * Hook for managing voice recording using MediaRecorder API
 *
 * Usage:
 * ```tsx
 * const { isRecording, startRecording, stopRecording, error } = useVoiceRecording()
 *
 * // Start recording (e.g., on mouse down)
 * await startRecording()
 *
 * // Stop recording and get audio blob (e.g., on mouse up)
 * const blob = await stopRecording()
 * ```
 */
export function useVoiceRecording(): UseVoiceRecordingReturn {
  const [isRecording, setIsRecording] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const [audioLevel, setAudioLevel] = useState(0)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const isStartingRef = useRef(false) // Prevent race conditions
  const startPromiseRef = useRef<Promise<void> | null>(null)
  const startGenerationRef = useRef(0)

  // Audio analysis refs
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const animationFrameRef = useRef<number | null>(null)

  // Cleanup function to stop all tracks and reset state
  const cleanup = useCallback(() => {
    // Stop animation frame
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }

    // Clean up audio analysis
    if (analyserRef.current) {
      analyserRef.current.disconnect()
      analyserRef.current = null
    }
    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      audioContextRef.current.close().catch(() => {})
      audioContextRef.current = null
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
    if (mediaRecorderRef.current) {
      if (mediaRecorderRef.current.state !== "inactive") {
        try {
          mediaRecorderRef.current.stop()
        } catch {
          // Ignore errors during cleanup
        }
      }
      mediaRecorderRef.current = null
    }
    chunksRef.current = []
    isStartingRef.current = false
    setAudioLevel(0)
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      startGenerationRef.current += 1
      startPromiseRef.current = null
      cleanup()
      setIsRecording(false)
    }
  }, [cleanup])

  // Cancel recording without returning a blob
  const cancelRecording = useCallback(() => {
    // getUserMedia cannot be aborted. Invalidate the pending generation so a
    // late stream is stopped before a MediaRecorder can start.
    startGenerationRef.current += 1
    startPromiseRef.current = null
    cleanup()
    setIsRecording(false)
  }, [cleanup])

  const startRecording = useCallback((): Promise<void> => {
    // Prevent multiple simultaneous starts
    if (startPromiseRef.current) {
      console.warn("[VoiceRecording] Already recording or starting")
      return startPromiseRef.current
    }
    if (mediaRecorderRef.current) {
      console.warn("[VoiceRecording] Already recording or starting")
      return Promise.resolve()
    }

    const generation = ++startGenerationRef.current
    isStartingRef.current = true
    const startPromise = (async () => {
      try {
        setError(null)

        // Request microphone access. A pending request cannot be aborted, so
        // cancellation is checked immediately after it resolves.
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            sampleRate: 16000, // Whisper works well with 16kHz
          },
        })
        if (generation !== startGenerationRef.current) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }

        streamRef.current = stream

        // Set up audio analysis for visualization
        try {
          const audioContext = new AudioContext()
          const analyser = audioContext.createAnalyser()
          analyser.fftSize = 256
          analyser.smoothingTimeConstant = 0.5

          const source = audioContext.createMediaStreamSource(stream)
          source.connect(analyser)

          audioContextRef.current = audioContext
          analyserRef.current = analyser

          // Start audio level monitoring (~20fps instead of 60fps to reduce React re-renders)
          const dataArray = new Uint8Array(analyser.frequencyBinCount)
          let frameCount = 0
          const updateLevel = () => {
            if (!analyserRef.current) return

            frameCount++
            // Only update state every 3rd frame (~20fps) - CSS transitions smooth the gaps
            if (frameCount % 3 === 0) {
              analyserRef.current.getByteFrequencyData(dataArray)

              let sum = 0
              for (let i = 0; i < dataArray.length; i++) {
                sum += dataArray[i] ?? 0
              }
              const average = sum / dataArray.length
              const raw = average / 255
              const amplified = Math.pow(raw, 0.6) * 2.5
              const normalized = Math.min(1, amplified)
              setAudioLevel(normalized)
            }

            animationFrameRef.current = requestAnimationFrame(updateLevel)
          }
          updateLevel()
        } catch (err) {
          console.warn("[VoiceRecording] Failed to set up audio analysis:", err)
          // Continue without audio level - recording still works
        }

        // Determine best supported mime type
        const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : MediaRecorder.isTypeSupported("audio/webm")
            ? "audio/webm"
            : "audio/mp4" // Fallback for Safari

        const mediaRecorder = new MediaRecorder(stream, { mimeType })

        chunksRef.current = []

        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            chunksRef.current.push(event.data)
          }
        }

        mediaRecorderRef.current = mediaRecorder
        mediaRecorder.start(100) // Collect data every 100ms
        setIsRecording(true)
      } catch (err) {
        if (generation !== startGenerationRef.current) return
        cleanup()

        const error = toMicrophoneError(err, navigator.platform)

        setError(error)
        console.error("[VoiceRecording] Start error:", error)
        throw error
      } finally {
        if (generation === startGenerationRef.current) {
          isStartingRef.current = false
          startPromiseRef.current = null
        }
      }
    })()
    startPromiseRef.current = startPromise
    return startPromise
  }, [cleanup])

  const stopRecording = useCallback(async (): Promise<Blob> => {
    // A hotkey or pointer release can arrive while microphone permission is
    // still pending. Wait for that exact start before looking for the recorder.
    const pendingStart = startPromiseRef.current
    if (pendingStart) await pendingStart

    return new Promise((resolve, reject) => {
      const mediaRecorder = mediaRecorderRef.current

      if (!mediaRecorder || mediaRecorder.state === "inactive") {
        const error = new Error("No active recording")
        setError(error)
        reject(error)
        return
      }

      // Store mimeType before stopping (some browsers clear it after stop)
      const mimeType = mediaRecorder.mimeType || "audio/webm"

      mediaRecorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: mimeType })

        cleanup()
        setIsRecording(false)
        try {
          resolve(await normalizeRecordingForWhisper(blob))
        } catch (error) {
          const normalized = error instanceof Error ? error : new Error(String(error))
          setError(normalized)
          reject(normalized)
        }
      }

      mediaRecorder.onerror = () => {
        const error = new Error("Recording error")
        setError(error)
        cleanup()
        setIsRecording(false)
        reject(error)
      }

      mediaRecorder.stop()
    })
  }, [cleanup])

  return {
    isRecording,
    error,
    audioLevel,
    startRecording,
    stopRecording,
    cancelRecording,
  }
}

/**
 * Decode Chromium's MediaRecorder output in the renderer and hand the main
 * process a 16 kHz mono PCM WAV. This keeps packaged dictation independent of
 * an FFmpeg installation.
 */
export async function normalizeRecordingForWhisper(blob: Blob): Promise<Blob> {
  if (blob.type.includes("wav") || blob.size === 0) return blob
  const context = new AudioContext()
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer())
    const frameCount = Math.max(1, Math.ceil(decoded.duration * 16_000))
    const offline = new OfflineAudioContext(1, frameCount, 16_000)
    const source = offline.createBufferSource()
    source.buffer = decoded
    source.connect(offline.destination)
    source.start()
    const rendered = await offline.startRendering()
    return new Blob([encodePcmWav(rendered.getChannelData(0), rendered.sampleRate)], {
      type: "audio/wav",
    })
  } finally {
    await context.close().catch(() => {})
  }
}

export function encodePcmWav(samples: Float32Array, sampleRate = 16_000): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const writeAscii = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index++)
      view.setUint8(offset + index, value.charCodeAt(index))
  }
  writeAscii(0, "RIFF")
  view.setUint32(4, 36 + samples.length * 2, true)
  writeAscii(8, "WAVE")
  writeAscii(12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeAscii(36, "data")
  view.setUint32(40, samples.length * 2, true)
  for (let index = 0; index < samples.length; index++) {
    const sample = Math.max(-1, Math.min(1, samples[index] ?? 0))
    view.setInt16(44 + index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
  }
  return buffer
}

export function toMicrophoneError(error: unknown, platform: string): Error {
  if (!(error instanceof Error)) return new Error("Failed to start recording")
  if (error.name === "NotAllowedError" || error.name === "PermissionDeniedError") {
    const recovery = platform.toLowerCase().includes("win")
      ? "Windows Settings > Privacy & security > Microphone"
      : "System Settings > Privacy & Security > Microphone"
    return new Error(`Microphone access denied. Allow Flapstack in ${recovery}.`)
  }
  if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
    return new Error("No microphone found. Please connect a microphone.")
  }
  if (error.name === "NotReadableError" || error.name === "TrackStartError") {
    return new Error("Microphone is in use by another application.")
  }
  return error
}

/**
 * Convert a Blob to base64 string
 */
export async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const result = reader.result as string
      // Remove data URL prefix (e.g., "data:audio/webm;base64,")
      const base64 = result.split(",")[1]
      if (base64) {
        resolve(base64)
      } else {
        reject(new Error("Failed to convert blob to base64"))
      }
    }
    reader.onerror = () => reject(new Error("Failed to read blob"))
    reader.readAsDataURL(blob)
  })
}

/**
 * Get audio format from mime type
 */
export function getAudioFormat(mimeType: string): "webm" | "mp3" | "m4a" | "wav" | "ogg" {
  if (mimeType.includes("webm")) return "webm"
  if (mimeType.includes("mp3") || mimeType.includes("mpeg")) return "mp3"
  if (mimeType.includes("mp4") || mimeType.includes("m4a")) return "m4a"
  if (mimeType.includes("wav")) return "wav"
  if (mimeType.includes("ogg")) return "ogg"
  return "webm" // Default
}
