"use client"

import { memo, useState, useRef, useCallback, useEffect, useMemo } from "react"
import { useAtom, useSetAtom } from "jotai"
import { ChevronLeft, ChevronRight } from "lucide-react"
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
import {
  getSpeechCursor,
  getSpeechDisplayTokens,
  getSpeechPlaybackPosition,
  getSpeechStartTime,
  extendSpeechRangeThroughPunctuation,
  normalizeSpeechDisplayWord,
  playManagedSpeech,
  setSpeechPlaybackPosition,
  stopManagedSpeech,
} from "../../../lib/speech-playback"
import { useHaptic } from "../hooks/use-haptic"
import {
  ttsPlaybackRateAtom,
  setTtsPlaybackRateAtom,
  MIN_PLAYBACK_SPEED,
  MAX_PLAYBACK_SPEED,
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
      aria-label="Copy message"
      title="Copy message"
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
  expandDirection?: "left" | "right"
  highlightColor?: SpeechHighlightColor
}

export const PlayButton = memo(function PlayButton({
  text,
  isMobile = false,
  chatId,
  subChatId,
  messageId,
  expandDirection = "right",
  highlightColor = "gray",
}: PlayButtonProps) {
  const playbackKey = messageId ?? `${chatId ?? "chat"}:${text}`
  const savedPosition = getSpeechPlaybackPosition(playbackKey)
  const [state, setState] = useState<PlayButtonState>("idle")
  const [currentTime, setCurrentTime] = useState(savedPosition.currentTime)
  const [duration, setDuration] = useState(savedPosition.duration)
  const [spokenText, setSpokenText] = useState(savedPosition.spokenText)
  const [isExpanded, setIsExpanded] = useState(false)
  const [playbackRate] = useAtom(ttsPlaybackRateAtom)
  const setPlaybackRate = useSetAtom(setTtsPlaybackRateAtom)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const mediaSourceRef = useRef<MediaSource | null>(null)
  const sourceBufferRef = useRef<SourceBuffer | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const chunkCountRef = useRef(0)
  const readingCursor = useMemo(
    () => getSpeechCursor(spokenText, currentTime, duration),
    [spokenText, currentTime, duration],
  )

  useEffect(() => {
    if (!messageId || !spokenText || readingCursor.count <= 0 || !CSS.highlights) {
      removeMessageSpeechHighlight(messageId)
      return
    }

    const ranges = findRenderedWordRanges(
      spokenText,
      readingCursor.count,
      readingCursor.wordProgress,
      messageId,
    )
    if (!ranges.length) return

    setMessageSpeechHighlight(messageId, ranges, highlightColor)
    const bounds = ranges[ranges.length - 1]!.getBoundingClientRect()
    if (bounds.top < 0 || bounds.bottom > window.innerHeight) {
      ranges[ranges.length - 1]!.startContainer.parentElement?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      })
    }

    return () => {
      removeMessageSpeechHighlight(messageId)
    }
  }, [messageId, spokenText, readingCursor.count, readingCursor.wordProgress, highlightColor])

  useEffect(() => {
    setSpeechPlaybackPosition(playbackKey, { currentTime, duration, spokenText })
  }, [playbackKey, currentTime, duration, spokenText])

  // Update playback rate when it changes
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackRate
    }
  }, [playbackRate])

  const cleanup = useCallback(() => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }
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
    const exactSpokenText = result.spokenText
    setSpokenText(exactSpokenText)
    setSpeechPlaybackPosition(playbackKey, { spokenText: exactSpokenText })
    const resumeAt = getSpeechStartTime(getSpeechPlaybackPosition(playbackKey))
    const audio = await playManagedSpeech(result, {
      rate: playbackRate,
      startTime: resumeAt,
      onEnded: () => {
        if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current)
        const finalDuration = Number.isFinite(audio.duration) ? audio.duration : duration
        setCurrentTime(finalDuration)
        setDuration(finalDuration)
        setState("idle")
        audioRef.current = null
      },
      onError: () => {
        if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current)
        setState("idle")
        audioRef.current = null
      },
      onStopped: () => {
        if (animationFrameRef.current !== null) cancelAnimationFrame(animationFrameRef.current)
        setState("idle")
        audioRef.current = null
      },
    })
    audio.ontimeupdate = () => {
      setCurrentTime(audio.currentTime)
      setSpeechPlaybackPosition(playbackKey, { currentTime: audio.currentTime })
    }
    const syncProgress = () => {
      setCurrentTime(audio.currentTime)
      setSpeechPlaybackPosition(playbackKey, { currentTime: audio.currentTime })
      if (!audio.paused && !audio.ended) {
        animationFrameRef.current = requestAnimationFrame(syncProgress)
      }
    }
    animationFrameRef.current = requestAnimationFrame(syncProgress)
    audio.ondurationchange = () => {
      const nextDuration = Number.isFinite(audio.duration) ? audio.duration : 0
      setDuration(nextDuration)
      setSpeechPlaybackPosition(playbackKey, { duration: nextDuration })
    }
    const nextDuration = Number.isFinite(audio.duration) ? audio.duration : duration
    setDuration(nextDuration)
    setCurrentTime(resumeAt)
    setSpeechPlaybackPosition(playbackKey, { currentTime: resumeAt, duration: nextDuration })
    audioRef.current = audio
    setState("playing")
  }, [text, playbackRate, chatId, subChatId, messageId, playbackKey, duration])

  const handlePlay = useCallback(async () => {
    setIsExpanded(true)

    // If playing, stop the audio (and halt any server-side synthesis).
    if (state === "playing") {
      stopManagedSpeech(audioRef.current)
      audioRef.current = null
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
    stopManagedSpeech()
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

  return (
    <div
      className={cn("relative flex items-center", expandDirection === "left" && "flex-row-reverse")}
    >
      <button
        onClick={handlePlay}
        tabIndex={0}
        aria-label={state === "playing" ? "Pause message audio" : "Play message audio"}
        title={state === "playing" ? "Pause message audio" : "Play message audio"}
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

      <button
        type="button"
        onClick={() => setIsExpanded((expanded) => !expanded)}
        tabIndex={0}
        aria-label={isExpanded ? "Hide speech controls" : "Show speech controls"}
        title={isExpanded ? "Hide speech controls" : "Show speech controls"}
        className="p-1 rounded-md transition-[background-color,transform] duration-150 ease-out hover:bg-accent active:scale-[0.97]"
      >
        {expandDirection === "left" ? (
          isExpanded ? (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ChevronLeft className="h-3.5 w-3.5 text-muted-foreground" />
          )
        ) : isExpanded ? (
          <ChevronLeft className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </button>

      {isExpanded && (
        <div
          className={cn(
            "flex items-center gap-1.5 text-[10px] text-muted-foreground",
            isMobile ? "max-w-[260px]" : "max-w-[340px]",
          )}
        >
          <input
            aria-label="Speech progress"
            title="Speech progress"
            type="range"
            min={0}
            max={duration || 1}
            step={0.1}
            value={Math.min(currentTime, duration || 1)}
            onChange={(event) => {
              const nextTime = Number(event.target.value)
              if (audioRef.current) audioRef.current.currentTime = nextTime
              setCurrentTime(nextTime)
              setSpeechPlaybackPosition(playbackKey, { currentTime: nextTime })
            }}
            className="h-1 w-20 accent-foreground"
          />
          <span className="w-8 tabular-nums">{formatSpeechTime(currentTime)}</span>
          <input
            aria-label="Playback speed"
            title={`Playback speed: ${playbackRate.toFixed(2)}x`}
            type="range"
            min={MIN_PLAYBACK_SPEED}
            max={MAX_PLAYBACK_SPEED}
            step={0.25}
            value={playbackRate}
            onChange={(event) => setPlaybackRate(Number(event.target.value))}
            className="h-1 w-14 accent-foreground"
          />
          <span className="w-8 tabular-nums">{playbackRate.toFixed(2)}x</span>
        </div>
      )}
    </div>
  )
})

type SpeechHighlightColor = "blue" | "orange" | "green" | "purple" | "rose" | "teal" | "gray"
const SPEECH_HIGHLIGHT_COLORS: SpeechHighlightColor[] = [
  "blue",
  "orange",
  "green",
  "purple",
  "rose",
  "teal",
  "gray",
]
const WORD_PATTERN = /[\p{L}\p{N}'’-]+/gu
const messageSpeechRanges = new Map<string, { ranges: Range[]; color: SpeechHighlightColor }>()

function normalizeWord(word: string) {
  return normalizeSpeechDisplayWord(word)
}

function findRenderedWordRanges(
  text: string,
  wordCount: number,
  wordProgress: number,
  messageId: string,
): Range[] {
  const sourceWords = getSpeechDisplayTokens(text, wordCount)
  const completedSourceWords = getSpeechDisplayTokens(text, Math.max(0, wordCount - 1)).length
  const currentSourceLength = sourceWords
    .slice(completedSourceWords)
    .reduce((total, word) => total + word.length, 0)
  let currentSourceCharacters = currentSourceLength * wordProgress
  const containers = Array.from(document.querySelectorAll<HTMLElement>("[data-message-id]")).filter(
    (element) => element.dataset.messageId === messageId,
  )
  const renderedWords: Array<{ node: Text; start: number; end: number; word: string }> = []
  for (const container of containers) {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode() as Text | null
    while (node) {
      for (const match of node.data.matchAll(WORD_PATTERN)) {
        if (match.index === undefined) continue
        renderedWords.push({
          node,
          start: match.index,
          end: extendSpeechRangeThroughPunctuation(node.data, match.index + match[0].length),
          word: normalizeWord(match[0]),
        })
      }
      node = walker.nextNode() as Text | null
    }
  }

  const ranges: Range[] = []
  let renderedIndex = 0
  for (let sourceIndex = 0; sourceIndex < sourceWords.length; sourceIndex += 1) {
    const sourceWord = sourceWords[sourceIndex]!
    while (
      renderedIndex < renderedWords.length &&
      renderedWords[renderedIndex]!.word !== sourceWord
    ) {
      renderedIndex += 1
    }
    const match = renderedWords[renderedIndex]
    if (!match) break
    let end = match.end
    if (sourceIndex >= completedSourceWords) {
      const visibleCharacters = Math.min(match.word.length, Math.max(0, currentSourceCharacters))
      currentSourceCharacters -= match.word.length
      if (visibleCharacters <= 0) break
      end =
        visibleCharacters >= match.word.length
          ? match.end
          : match.start + Math.max(1, Math.ceil(visibleCharacters))
    }
    const range = document.createRange()
    range.setStart(match.node, match.start)
    range.setEnd(match.node, Math.min(match.end, end))
    ranges.push(range)
    renderedIndex += 1
  }
  return ranges
}

function setMessageSpeechHighlight(
  messageId: string,
  ranges: Range[],
  color: SpeechHighlightColor,
) {
  messageSpeechRanges.set(messageId, { ranges, color })
  refreshSpeechHighlights()
}

function removeMessageSpeechHighlight(messageId?: string) {
  if (!messageId || !messageSpeechRanges.delete(messageId)) return
  refreshSpeechHighlights()
}

function refreshSpeechHighlights() {
  if (!CSS.highlights) return
  const highlights = CSS.highlights as HighlightRegistry &
    Pick<Map<string, Highlight>, "set" | "delete">
  for (const color of SPEECH_HIGHLIGHT_COLORS) {
    const ranges = Array.from(messageSpeechRanges.values())
      .filter((entry) => entry.color === color)
      .flatMap((entry) => entry.ranges)
    const name = `speech-reading-${color}`
    if (ranges.length) highlights.set(name, new Highlight(...ranges))
    else highlights.delete(name)
  }
}

function formatSpeechTime(seconds: number) {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0
  return `${Math.floor(safeSeconds / 60)}:${String(safeSeconds % 60).padStart(2, "0")}`
}

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
