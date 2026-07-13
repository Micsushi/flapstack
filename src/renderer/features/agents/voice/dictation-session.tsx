"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { useAtomValue, useSetAtom } from "jotai"
import { Mic, Square } from "lucide-react"
import { toast } from "sonner"

import { Button } from "../../../components/ui/button"
import { trpc } from "../../../lib/trpc"
import {
  blobToBase64,
  float32ToBase64,
  getAudioFormat,
  useVoiceRecording,
} from "../../../lib/hooks/use-voice-recording"
import {
  selectedAgentChatIdAtom,
  selectedChatIsRemoteAtom,
  selectedDraftIdAtom,
  showNewChatFormAtom,
} from "../atoms"

export type DictationTarget = {
  key: string
  chatId?: string
  subChatId?: string
  draftId?: string
  projectLabel: string
  chatLabel: string
  getText: () => string
  commitText: (text: string) => void
  showText: (text: string) => void
}

type DictationSessionValue = {
  activeTargetKey: string | null
  isRecording: boolean
  isStarting: boolean
  isTranscribing: boolean
  audioLevel: number
  start: (target: DictationTarget) => Promise<void>
  stop: () => Promise<void>
}

const DictationSessionContext = createContext<DictationSessionValue | null>(null)

function appendSpeech(draft: string, speech: string): string {
  const clean = speech.replace(/[\r\n\t]+/g, " ")
  return `${draft}${draft && clean && !/\s$/.test(draft) ? " " : ""}${clean}`
}

export function DictationSessionProvider({ children }: { children: React.ReactNode }) {
  const setSelectedChatId = useSetAtom(selectedAgentChatIdAtom)
  const selectedChatId = useAtomValue(selectedAgentChatIdAtom)
  const setSelectedChatIsRemote = useSetAtom(selectedChatIsRemoteAtom)
  const setSelectedDraftId = useSetAtom(selectedDraftIdAtom)
  const selectedDraftId = useAtomValue(selectedDraftIdAtom)
  const setShowNewChatForm = useSetAtom(showNewChatFormAtom)
  const showNewChatForm = useAtomValue(showNewChatFormAtom)
  const { data: voiceSettings } = trpc.speech.getSettings.useQuery()
  const startStreamingMutation = trpc.voice.startStreaming.useMutation()
  const feedStreamingMutation = trpc.voice.feedStreaming.useMutation()
  const finalizeStreamingMutation = trpc.voice.finalizeStreaming.useMutation()
  const cancelStreamingMutation = trpc.voice.cancelStreaming.useMutation()
  const transcribeMutation = trpc.voice.transcribe.useMutation()
  const [activeTarget, setActiveTarget] = useState<DictationTarget | null>(null)
  const [isStarting, setIsStarting] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [startedAt, setStartedAt] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const activeTargetRef = useRef<DictationTarget | null>(null)
  const baseDraftRef = useRef("")
  const streamStartRef = useRef<Promise<unknown> | null>(null)
  const operationRef = useRef<Promise<void> | null>(null)

  const publish = useCallback((text: string) => {
    const target = activeTargetRef.current
    if (!target) return
    target.commitText(text)
    target.showText(text)
  }, [])

  const applyStreamingTranscript = useCallback(
    (committed: string, tentative: string) => {
      publish(appendSpeech(baseDraftRef.current, `${committed}${tentative}`))
    },
    [publish],
  )

  const { isRecording, audioLevel, startRecording, stopRecording, cancelRecording, waitForPcm } =
    useVoiceRecording({
      normalizeRecording: voiceSettings?.sttAdapterId !== "local-parakeet",
      onPcmChunk: async (chunk) => {
        if (streamStartRef.current) await streamStartRef.current
        const update = await feedStreamingMutation.mutateAsync({
          pcmBase64: float32ToBase64(chunk),
        })
        applyStreamingTranscript(update.committed, update.tentative)
      },
    })

  useEffect(() => {
    if (!startedAt) return
    const update = () => setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)))
    update()
    const timer = window.setInterval(update, 1000)
    return () => window.clearInterval(timer)
  }, [startedAt])

  const stop = useCallback(async () => {
    if (operationRef.current) return operationRef.current
    if (!activeTargetRef.current) return
    const operation = (async () => {
      setIsTranscribing(true)
      try {
        const target = activeTargetRef.current
        const blob = await stopRecording()
        if (voiceSettings?.sttAdapterId === "local-parakeet") {
          await waitForPcm()
          const result = await finalizeStreamingMutation.mutateAsync()
          publish(appendSpeech(baseDraftRef.current, result.text.trim()))
          if (!result.text.trim()) toast.info("No speech detected")
        } else if (blob.size >= 1000 && target) {
          const result = await transcribeMutation.mutateAsync({
            audio: await blobToBase64(blob),
            format: getAudioFormat(blob.type),
            chatId: target.chatId,
            subChatId: target.subChatId,
          })
          if (result.text.trim()) publish(appendSpeech(baseDraftRef.current, result.text.trim()))
          else toast.info("No speech detected")
        }
      } catch (error) {
        console.error("[DictationSession] Finalization failed:", error)
        toast.error("Voice transcription failed", {
          description: error instanceof Error ? error.message : "Could not finish dictation.",
        })
      } finally {
        activeTargetRef.current = null
        setActiveTarget(null)
        setStartedAt(0)
        setElapsed(0)
        setIsTranscribing(false)
        streamStartRef.current = null
      }
    })()
    operationRef.current = operation
    await operation.finally(() => {
      if (operationRef.current === operation) operationRef.current = null
    })
  }, [
    finalizeStreamingMutation,
    publish,
    stopRecording,
    transcribeMutation,
    voiceSettings?.sttAdapterId,
    waitForPcm,
  ])

  const start = useCallback(
    async (target: DictationTarget) => {
      if (activeTargetRef.current || operationRef.current) await stop()
      setIsStarting(true)
      activeTargetRef.current = target
      setActiveTarget(target)
      baseDraftRef.current = target.getText()
      target.commitText(baseDraftRef.current)
      try {
        if (voiceSettings?.sttAdapterId === "local-parakeet") {
          const streamStart = startStreamingMutation.mutateAsync({
            chatId: target.chatId,
            subChatId: target.subChatId,
          })
          streamStartRef.current = streamStart
          await Promise.all([streamStart, startRecording()])
        } else {
          await startRecording()
        }
        setStartedAt(Date.now())
      } catch (error) {
        activeTargetRef.current = null
        setActiveTarget(null)
        cancelRecording()
        cancelStreamingMutation.mutate()
        toast.error(error instanceof Error ? error.message : "Failed to start recording")
      } finally {
        streamStartRef.current = null
        setIsStarting(false)
      }
    },
    [
      cancelRecording,
      cancelStreamingMutation,
      startRecording,
      startStreamingMutation,
      stop,
      voiceSettings?.sttAdapterId,
    ],
  )

  const goBack = useCallback(() => {
    const target = activeTargetRef.current
    if (!target) return
    if (target.chatId) {
      setSelectedDraftId(null)
      setShowNewChatForm(false)
      setSelectedChatIsRemote(false)
      setSelectedChatId(target.chatId)
    } else if (target.draftId) {
      setSelectedChatId(null)
      setSelectedDraftId(target.draftId)
      setShowNewChatForm(true)
    }
  }, [setSelectedChatId, setSelectedChatIsRemote, setSelectedDraftId, setShowNewChatForm])

  const value = useMemo<DictationSessionValue>(
    () => ({
      activeTargetKey: activeTarget?.key ?? null,
      isRecording,
      isStarting,
      isTranscribing,
      audioLevel,
      start,
      stop,
    }),
    [activeTarget?.key, audioLevel, isRecording, isStarting, isTranscribing, start, stop],
  )
  const originIsVisible = Boolean(
    activeTarget &&
    (activeTarget.chatId
      ? activeTarget.chatId === selectedChatId
      : activeTarget.draftId === selectedDraftId && !selectedChatId && showNewChatForm),
  )

  return (
    <DictationSessionContext.Provider value={value}>
      {children}
      {activeTarget && !originIsVisible && (
        <div className="fixed bottom-4 right-4 z-[100] flex max-w-sm items-center gap-3 rounded-lg border border-border bg-popover px-3 py-2 text-popover-foreground shadow-lg">
          <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-500/15 text-red-500">
            <Mic className="h-4 w-4" />
            <span className="absolute right-0 top-0 h-2 w-2 animate-pulse rounded-full bg-red-500" />
          </span>
          <button type="button" className="min-w-0 flex-1 text-left" onClick={goBack}>
            <div className="truncate text-xs font-medium">
              Recording · {activeTarget.projectLabel}
            </div>
            <div className="truncate text-xs text-muted-foreground">
              {activeTarget.chatLabel} · {Math.floor(elapsed / 60)}:
              {String(elapsed % 60).padStart(2, "0")}
            </div>
          </button>
          <Button size="sm" variant="ghost" onClick={goBack}>
            Go back
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Stop background dictation"
            onClick={() => void stop()}
          >
            <Square className="h-3.5 w-3.5 fill-current" />
          </Button>
        </div>
      )}
    </DictationSessionContext.Provider>
  )
}

export function useDictationSession(): DictationSessionValue {
  const value = useContext(DictationSessionContext)
  if (!value) throw new Error("useDictationSession must be used inside DictationSessionProvider")
  return value
}
