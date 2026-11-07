"use client"

import { useEffect, useId, useMemo, useRef, useState } from "react"
import { ChevronLeft, ChevronRight, Mic, Square, X } from "lucide-react"
import { Button } from "../../../components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "../../../components/ui/dialog"
import type { DictationSessionValue } from "../voice/dictation-session"
import { cn } from "../../../lib/utils"
import type { PendingUserQuestions } from "../atoms"

type AgentInputDialogProps = {
  request: PendingUserQuestions
  open: boolean
  onOpenChange: (open: boolean) => void
  onAnswer: (answers: Record<string, string[]>) => void | Promise<void>
  onSkip: () => void | Promise<void>
  onAnswerInChat: () => void
  dictation?: DictationSessionValue
}

export function useAgentInputDisclosure(
  requestId: string | undefined,
  active: boolean,
  autoOpen = false,
) {
  const [openedRequestId, setOpenedRequestId] = useState<string | null>(null)
  useEffect(() => {
    setOpenedRequestId(autoOpen && active ? (requestId ?? null) : null)
  }, [requestId, active, autoOpen])
  return {
    open: active && Boolean(requestId) && openedRequestId === requestId,
    setOpen: (open: boolean) => setOpenedRequestId(open && active ? (requestId ?? null) : null),
  }
}

export function AgentInputDialog({
  request,
  open,
  onOpenChange,
  onAnswer,
  onSkip,
  onAnswerInChat,
  dictation,
}: AgentInputDialogProps) {
  const titleId = useId()
  const descriptionId = useId()
  const [questionIndex, setQuestionIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string[]>>({})
  const [customAnswers, setCustomAnswers] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const permission = request.request?.kind === "permission"
  const dictationRef = useRef(dictation)
  dictationRef.current = dictation
  const dictationKey = `agent-input:${request.toolUseId}:${questionIndex}`
  const ownsDictation = dictation?.activeTargetKey === dictationKey
  const dictationBusy =
    ownsDictation && (dictation?.isStarting || dictation?.isRecording || dictation?.isTranscribing)
  useEffect(
    () => () => {
      if (dictationRef.current?.activeTargetKey === dictationKey) void dictationRef.current.cancel()
    },
    [dictationKey, open],
  )
  const firstOptionRef = useRef<HTMLInputElement>(null)
  const customAnswerRef = useRef<HTMLTextAreaElement>(null)
  const isContinuation =
    request.request?.capability.mode === "continuation" ||
    request.request?.capability.mode === "unsupported"

  useEffect(() => {
    setQuestionIndex(0)
    setAnswers({})
    setCustomAnswers({})
    setSubmitting(false)
    setError(null)
  }, [request.toolUseId])

  useEffect(() => {
    if (!open) return
    const frame = window.requestAnimationFrame(() => {
      const answerControl = firstOptionRef.current ?? customAnswerRef.current
      answerControl?.focus()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [open, questionIndex, request.toolUseId])

  const question = request.questions[questionIndex]
  const allAnswered = useMemo(
    () =>
      request.questions.every((item) => {
        const selected = answers[item.id] ?? []
        return selected.length > 0 || Boolean(customAnswers[item.id]?.trim())
      }),
    [answers, customAnswers, request.questions],
  )

  if (!question || !open) return null

  const selected = answers[question.id] ?? []
  const custom = customAnswers[question.id] ?? ""
  const chooseOption = (optionId: string) => {
    setAnswers((current) => {
      const prior = current[question.id] ?? []
      return {
        ...current,
        [question.id]: question.multiSelect
          ? prior.includes(optionId)
            ? prior.filter((value) => value !== optionId)
            : [...prior, optionId]
          : [optionId],
      }
    })
    if (!question.multiSelect) {
      setCustomAnswers((current) => ({ ...current, [question.id]: "" }))
    }
  }

  const updateCustom = (value: string) => {
    setCustomAnswers((current) => ({ ...current, [question.id]: value }))
    if (!question.multiSelect && value) {
      setAnswers((current) => ({ ...current, [question.id]: [] }))
    }
  }

  const submit = async () => {
    if (!allAnswered || submitting || dictationBusy) return
    setError(null)
    setSubmitting(true)
    try {
      const formatted = Object.fromEntries(
        request.questions.map((item) => {
          const labelsById = new Map(item.options.map((option) => [option.id, option.label]))
          const values = (answers[item.id] ?? []).map(
            (optionId) => labelsById.get(optionId) ?? optionId,
          )
          const customValue = customAnswers[item.id]?.trim()
          if (customValue) values.push(item.options.length ? `Other: ${customValue}` : customValue)
          return [item.id, values]
        }),
      )
      await onAnswer(formatted)
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not send your answer. Try again.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="w-[640px] gap-0 overflow-hidden p-0"
      >
        <header className="border-b border-border px-4 py-3 pr-12">
          <DialogTitle id={titleId} className="text-sm font-semibold">
            {permission ? "Permission needed" : question.header || "Question"}
          </DialogTitle>
          <DialogDescription id={descriptionId} className="sr-only">
            Question {questionIndex + 1} of {request.questions.length}.{" "}
            {isContinuation
              ? "This answer continues as a normal user turn."
              : "The run is paused until you answer or skip."}
          </DialogDescription>
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-2 top-2 h-7 w-7"
            aria-label={permission ? "Close permission dialog" : "Minimize questions"}
            onClick={() => onOpenChange(false)}
          >
            <X className="h-4 w-4" />
          </Button>
        </header>

        <div className="max-h-[42vh] overflow-y-auto px-4 py-3">
          <fieldset disabled={submitting}>
            <legend className="mb-4 whitespace-pre-wrap break-words text-sm font-medium text-foreground">
              {question.question}
            </legend>
            <div className="space-y-2">
              {question.options.map((option, optionIndex) => {
                const checked = selected.includes(option.id)
                return (
                  <label
                    key={option.id}
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
                      checked ? "border-foreground/40 bg-muted" : "border-border hover:bg-muted/50",
                    )}
                  >
                    <input
                      ref={optionIndex === 0 ? firstOptionRef : undefined}
                      type={question.multiSelect ? "checkbox" : "radio"}
                      name={`agent-input-${request.toolUseId}-${questionIndex}`}
                      checked={checked}
                      onChange={() => chooseOption(option.id)}
                      className="mt-1"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{option.label}</span>
                      {option.description && (
                        <span className="block text-xs text-muted-foreground">
                          {option.description}
                        </span>
                      )}
                    </span>
                  </label>
                )
              })}
            </div>

            {question.allowCustom && !permission && (
              <div className="mt-4">
                <label className="block text-xs font-medium text-muted-foreground">
                  Your answer
                  <textarea
                    ref={customAnswerRef}
                    value={custom}
                    onChange={(event) => updateCustom(event.target.value)}
                    rows={3}
                    maxLength={4_000}
                    placeholder="Type your answer or use the microphone"
                    className="mt-1 w-full resize-y rounded-lg border border-border bg-background p-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                  />
                </label>
                {dictation && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={
                      submitting ||
                      (ownsDictation && (dictation.isStarting || dictation.isTranscribing))
                    }
                    aria-label={
                      ownsDictation && dictation.isRecording ? "Stop dictation" : "Dictate answer"
                    }
                    onClick={() => {
                      if (ownsDictation && dictation.isRecording) {
                        void dictation.stop()
                        return
                      }
                      void dictation.start({
                        key: dictationKey,
                        chatId: request.parentChatId,
                        subChatId: request.subChatId,
                        projectLabel: "Question",
                        chatLabel: question.header || "Your answer",
                        getText: () => custom,
                        commitText: (text) => updateCustom(text.slice(0, 4000)),
                        showText: () => customAnswerRef.current?.focus(),
                      })
                    }}
                  >
                    {ownsDictation && dictation.isRecording ? (
                      <Square className="mr-2 h-4 w-4" />
                    ) : (
                      <Mic className="mr-2 h-4 w-4" />
                    )}
                    {ownsDictation && dictation.isTranscribing
                      ? "Transcribing…"
                      : ownsDictation && dictation.isRecording
                        ? "Stop dictation"
                        : "Dictate answer"}
                  </Button>
                )}
              </div>
            )}
            {question.multiSelect && custom && (
              <p className="mt-1 text-xs text-muted-foreground">
                Custom text will be added to the selected choices.
              </p>
            )}
          </fieldset>
        </div>

        {error && (
          <p role="alert" className="px-4 pb-3 text-sm text-destructive">
            {error}
          </p>
        )}
        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-3">
          <div className="flex gap-2">
            {!permission && (
              <>
                <Button variant="ghost" onClick={onAnswerInChat} disabled={submitting}>
                  Answer in chat
                </Button>
                <Button variant="ghost" onClick={onSkip} disabled={submitting}>
                  Skip all
                </Button>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            {request.questions.length > 1 && (
              <Button
                variant="outline"
                size="icon"
                aria-label="Previous question"
                disabled={questionIndex === 0 || submitting || dictationBusy}
                onClick={() => setQuestionIndex((index) => Math.max(0, index - 1))}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
            )}
            {questionIndex < request.questions.length - 1 ? (
              <Button
                onClick={() => setQuestionIndex((index) => index + 1)}
                disabled={submitting || dictationBusy || (selected.length === 0 && !custom.trim())}
              >
                Next <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            ) : (
              <Button onClick={submit} disabled={!allAnswered || submitting || dictationBusy}>
                {submitting ? "Sending..." : permission ? "Confirm" : "Send answer"}
              </Button>
            )}
          </div>
        </footer>
      </DialogContent>
    </Dialog>
  )
}
