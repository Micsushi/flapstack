"use client"

import { memo, useState, useRef, useCallback, useEffect } from "react"
import { useAtom, useSetAtom } from "jotai"
import {
  CheckIcon,
  CopyIcon,
  IconSpinner,
  PauseIcon,
  VolumeIcon,
} from "../../../components/ui/icons"
import { cn } from "../../../lib/utils"
import { trpcClient } from "../../../lib/trpc"
import { buildMessageSpeechRequest } from "../../../lib/message-speech-request"
import { playManagedSpeech, stopManagedSpeech } from "../../../lib/speech-playback"
import { useHaptic } from "../hooks/use-haptic"
import {
  ttsPlaybackRateAtom,
  setTtsPlaybackRateAtom,
  PLAYBACK_SPEEDS,
  type PlaybackSpeed,
} from "../stores/message-store"

// ============================================================================
// COPY BUTTON - Memoized component for copying text
// ============================================================================

interface CopyButtonProps {
  text: string
  isMobile?: boolean
}

export const CopyButton = memo(function CopyButton({ text, isMobile = false }: CopyButtonProps) {
  const [copied, setCopied] = useState(false)
  const { trigger: triggerHaptic } = useHaptic()

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text)
    triggerHaptic("medium")
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [text, triggerHaptic])

  return (
    <button
      onClick={handleCopy}
      tabIndex={-1}
      className="p-1.5 rounded-md transition-[background-color,transform] duration-150 ease-out hover:bg-accent active:scale-[0.97]"
    >
      <div className="relative w-3.5 h-3.5">
        <CopyIcon
          className={cn(
            "absolute inset-0 w-3.5 h-3.5 text-muted-foreground transition-[opacity,transform] duration-200 ease-out",
            copied ? "opacity-0 scale-50" : "opacity-100 scale-100",
          )}
        />
        <CheckIcon
          className={cn(
            "absolute inset-0 w-3.5 h-3.5 text-muted-foreground transition-[opacity,transform] duration-200 ease-out",
            copied ? "opacity-100 scale-100" : "opacity-0 scale-50",
          )}
        />
      </div>
    </button>
  )
})

// ============================================================================
// PLAY BUTTON - TTS with streaming support, uses Jotai for playback rate
// ============================================================================

type PlayButtonState = "idle" | "loading" | "playing"

interface PlayButtonProps {
  text: string
  isMobile?: boolean
  chatId?: string
  subChatId?: string
  messageId?: string
}

export const PlayButton = memo(function PlayButton({
  text,
  isMobile = false,
  chatId,
  subChatId,
  messageId,
}: PlayButtonProps) {
  const [state, setState] = useState<PlayButtonState>("idle")
  const [playbackRate] = useAtom(ttsPlaybackRateAtom)
  const setPlaybackRate = useSetAtom(setTtsPlaybackRateAtom)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const mediaSourceRef = useRef<MediaSource | null>(null)
  const sourceBufferRef = useRef<SourceBuffer | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const chunkCountRef = useRef(0)

  // Update playback rate when it changes
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackRate
    }
  }, [playbackRate])

  const cleanup = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    stopManagedSpeech(audioRef.current)
    if (mediaSourceRef.current && mediaSourceRef.current.readyState === "open") {
      try {
        mediaSourceRef.current.endOfStream()
      } catch {
        // Ignore errors during cleanup
      }
    }
    audioRef.current = null
    mediaSourceRef.current = null
    sourceBufferRef.current = null
    chunkCountRef.current = 0
  }, [])

  const playWithFallback = useCallback(async () => {
    abortControllerRef.current = new AbortController()

    const result = await trpcClient.speech.speak.mutate(
      buildMessageSpeechRequest({ text, chatId, subChatId, messageId }),
      { signal: abortControllerRef.current.signal },
    )
    if (result.skipped) {
      setState("idle")
      return
    }
    const audio = await playManagedSpeech(result, {
      rate: playbackRate,
      onEnded: () => setState("idle"),
      onError: () => setState("idle"),
      onStopped: () => setState("idle"),
    })
    audioRef.current = audio
    setState("playing")
  }, [text, playbackRate, chatId, subChatId, messageId])

  const handlePlay = useCallback(async () => {
    // If playing, stop the audio (and halt any server-side synthesis).
    if (state === "playing") {
      cleanup()
      void trpcClient.speech.stopSpeaking.mutate()
      setState("idle")
      return
    }

    // If loading, cancel and reset (abort the request + stop synthesis).
    if (state === "loading") {
      cleanup()
      void trpcClient.speech.stopSpeaking.mutate()
      setState("idle")
      return
    }

    // Preempt current renderer playback immediately. Waiting for the next
    // synthesis result would allow the old utterance to keep talking.
    cleanup()
    setState("loading")
    chunkCountRef.current = 0

    try {
      await playWithFallback()
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        console.error("[PlayButton] TTS error:", error)
      }
      cleanup()
      setState("idle")
    }
  }, [state, cleanup, playWithFallback])

  // Cleanup on unmount
  useEffect(() => {
    return cleanup
  }, [cleanup])

  const handleSpeedChange = useCallback(() => {
    const currentIndex = PLAYBACK_SPEEDS.indexOf(playbackRate)
    const nextIndex = (currentIndex + 1) % PLAYBACK_SPEEDS.length
    setPlaybackRate(PLAYBACK_SPEEDS[nextIndex]!)
  }, [playbackRate, setPlaybackRate])

  return (
    <div className="relative flex items-center">
      <button
        onClick={handlePlay}
        tabIndex={-1}
        className={cn(
          "p-1.5 rounded-md transition-[background-color,transform] duration-150 ease-out hover:bg-accent active:scale-[0.97]",
          state === "loading" && "cursor-wait",
        )}
      >
        <div className="relative w-3.5 h-3.5">
          {state === "loading" ? (
            <IconSpinner className="w-3.5 h-3.5 text-muted-foreground animate-spin" />
          ) : state === "playing" ? (
            <PauseIcon className="w-3.5 h-3.5 text-muted-foreground" />
          ) : (
            <VolumeIcon className="w-3.5 h-3.5 text-muted-foreground" />
          )}
        </div>
      </button>

      {/* Speed selector - cyclic button with animation, only visible when playing */}
      {state === "playing" && (
        <button
          onClick={handleSpeedChange}
          tabIndex={-1}
          className={cn(
            "p-1.5 rounded-md transition-[background-color,opacity,transform] duration-150 ease-out hover:bg-accent active:scale-[0.97]",
            isMobile ? "opacity-100" : "opacity-0 group-hover/message:opacity-100",
          )}
        >
          <div className="relative w-4 h-3.5 flex items-center justify-center">
            {PLAYBACK_SPEEDS.map((speed) => (
              <span
                key={speed}
                className={cn(
                  "absolute inset-0 flex items-center justify-center text-xs font-medium text-muted-foreground transition-[opacity,transform] duration-200 ease-out",
                  speed === playbackRate ? "opacity-100 scale-100" : "opacity-0 scale-50",
                )}
              >
                {speed}x
              </span>
            ))}
          </div>
        </button>
      )}
    </div>
  )
})

// ============================================================================
// HELPER - Get text content from message
// ============================================================================

export function getMessageTextContent(msg: any): string {
  if (!msg?.parts) return ""
  return msg.parts
    .filter((p: any) => p.type === "text")
    .map((p: any) => p.text || "")
    .join("\n")
}
