"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { useAtomValue, useSetAtom } from "jotai"
import { Mic, Square } from "lucide-react"
import { toast } from "sonner"

import { Button } from "../../../components/ui/button"
import { trpc } from "../../../lib/trpc"
import { composeDictationDraft } from "../../../../shared/streaming-transcript"
import type { SelectedSpeechContext } from "../../../../shared/speech-vocabulary"
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
  selectedContext?: SelectedSpeechContext
  allowCloudSelectedContext?: boolean
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

export function DictationSessionProvider({ children }: { children: React.ReactNode }) {
  const utils = trpc.useUtils()
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
  const updateSettingsMutation = trpc.speech.updateSettings.useMutation()
  const [activeTarget, setActiveTarget] = useState<DictationTarget | null>(null)
  const [isStarting, setIsStarting] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [startedAt, setStartedAt] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const activeTargetRef = useRef<DictationTarget | null>(null)
  const baseDraftRef = useRef("")
  const streamStartRef = useRef<Promise<unknown> | null>(null)
  const operationRef = useRef<Promise<void> | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const startGenerationRef = useRef(0)
  const startingRef = useRef(false)
  const migratedLegacyRateRef = useRef(false)

  const publish = useCallback((text: string) => {
    const target = activeTargetRef.current
    if (!target) return
    target.commitText(text)
    target.showText(text)
  }, [])

  const applyStreamingTranscript = useCallback(
    (committed: string, tentative: string) => {
      publish(composeDictationDraft(baseDraftRef.current, committed, tentative))
    },
    [publish],
  )

  useEffect(() => {
    if (!voiceSettings || migratedLegacyRateRef.current) return
    migratedLegacyRateRef.current = true
    const legacy = window.localStorage.getItem("tts-playback-rate")
    const rate = Number(legacy)
    if (!legacy || !Number.isFinite(rate)) return
    void updateSettingsMutation
      .mutateAsync({ rate: Math.max(0.5, Math.min(2, rate)) })
      .then(async () => {
        window.localStorage.removeItem("tts-playback-rate")
        await utils.speech.getSettings.invalidate()
      })
      .catch((error) => console.warn("[Voice] Legacy playback rate migration failed", error))
  }, [updateSettingsMutation, utils.speech.getSettings, voiceSettings])

  const { isRecording, audioLevel, startRecording, stopRecording, cancelRecording, waitForPcm } =
    useVoiceRecording({
      normalizeRecording: voiceSettings?.sttAdapterId !== "local-parakeet",
      onPcmChunk: async (chunk) => {
        if (streamStartRef.current) await streamStartRef.current
        const sessionId = sessionIdRef.current
        if (!sessionId) return
        const update = await feedStreamingMutation.mutateAsync({
          sessionId,
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
    if (startingRef.current) {
      const sessionId = sessionIdRef.current
      startGenerationRef.current += 1
      startingRef.current = false
      activeTargetRef.current = null
      sessionIdRef.current = null
      setActiveTarget(null)
      setIsStarting(false)
      cancelRecording()
      if (sessionId) await cancelStreamingMutation.mutateAsync({ sessionId }).catch(() => undefined)
      streamStartRef.current = null
      return
    }
    const sessionId = sessionIdRef.current
    const operation = (async () => {
      setIsTranscribing(true)
      try {
        const target = activeTargetRef.current
        const blob = await stopRecording()
        if (voiceSettings?.sttAdapterId === "local-parakeet") {
          await waitForPcm()
          const result = await finalizeStreamingMutation.mutateAsync({
            sessionId: sessionIdRef.current ?? "",
          })
          publish(composeDictationDraft(baseDraftRef.current, result.text.trim()))
          if (!result.historySaved)
            toast.warning("Transcript kept in the draft but Voice History could not save", {
              description: result.historyError || undefined,
            })
          if (!result.text.trim()) toast.info("No speech detected")
        } else if (blob.size >= 1000 && target) {
          const result = await transcribeMutation.mutateAsync({
            audio: await blobToBase64(blob),
            format: getAudioFormat(blob.type),
            chatId: target.chatId,
            subChatId: target.subChatId,
            originKind: target.chatId ? "chat" : "new-chat",
            originId: target.chatId ?? target.draftId,
            originLabel: `${target.projectLabel} / ${target.chatLabel}`,
            selectedContext: target.selectedContext,
            allowCloudSelectedContext: target.allowCloudSelectedContext ?? false,
          })
          if (result.text.trim())
            publish(composeDictationDraft(baseDraftRef.current, result.text.trim()))
          else toast.info("No speech detected")
          if (!result.historySaved)
            toast.warning("Transcript kept in the draft but Voice History could not save", {
              description: result.historyError || undefined,
            })
        }
      } catch (error) {
        if (voiceSettings?.sttAdapterId === "local-parakeet" && sessionId)
          await cancelStreamingMutation.mutateAsync({ sessionId }).catch(() => undefined)
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
        sessionIdRef.current = null
      }
    })()
    operationRef.current = operation
    await operation.finally(() => {
      if (operationRef.current === operation) operationRef.current = null
    })
  }, [
    cancelRecording,
    cancelStreamingMutation,
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
      const generation = ++startGenerationRef.current
      const sessionId = window.crypto.randomUUID()
      sessionIdRef.current = sessionId
      startingRef.current = true
      setIsStarting(true)
      activeTargetRef.current = target
      setActiveTarget(target)
      baseDraftRef.current = target.getText()
      target.commitText(baseDraftRef.current)
      try {
        if (voiceSettings?.sttAdapterId === "local-parakeet") {
          const streamStart = startStreamingMutation.mutateAsync({
            sessionId,
            chatId: target.chatId,
            subChatId: target.subChatId,
            originKind: target.chatId ? "chat" : "new-chat",
            originId: target.chatId ?? target.draftId,
            originLabel: `${target.projectLabel} / ${target.chatLabel}`,
            selectedContext: target.selectedContext,
            allowCloudSelectedContext: target.allowCloudSelectedContext ?? false,
          })
          streamStartRef.current = streamStart
          await Promise.all([streamStart, startRecording()])
        } else {
          await startRecording()
        }
        if (generation !== startGenerationRef.current) return
        setStartedAt(Date.now())
      } catch (error) {
        if (generation !== startGenerationRef.current) return
        activeTargetRef.current = null
        setActiveTarget(null)
        cancelRecording()
        cancelStreamingMutation.mutate({ sessionId })
        toast.error(error instanceof Error ? error.message : "Failed to start recording")
      } finally {
        if (generation === startGenerationRef.current) {
          startingRef.current = false
          streamStartRef.current = null
          setIsStarting(false)
        }
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
