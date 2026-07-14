"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "../../../components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog"
import { cn } from "../../../lib/utils"
import type { PendingUserQuestions } from "../atoms"

type AgentInputDialogProps = {
  request: PendingUserQuestions
  open: boolean
  onOpenChange: (open: boolean) => void
  onAnswer: (answers: Record<string, string[]>) => void | Promise<void>
  onSkip: () => void | Promise<void>
  onAnswerInChat: () => void
}

export function AgentInputDialog({
  request,
  open,
  onOpenChange,
  onAnswer,
  onSkip,
  onAnswerInChat,
}: AgentInputDialogProps) {
  const [questionIndex, setQuestionIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string[]>>({})
  const [customAnswers, setCustomAnswers] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)
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

  if (!question) return null

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
    if (!allAnswered || submitting) return
    setSubmitting(true)
    try {
      const formatted = Object.fromEntries(
        request.questions.map((item) => {
          const labelsById = new Map(item.options.map((option) => [option.id, option.label]))
          const values = (answers[item.id] ?? []).map(
            (optionId) => labelsById.get(optionId) ?? optionId,
          )
          const customValue = customAnswers[item.id]?.trim()
          if (customValue) values.push(`Other: ${customValue}`)
          return [item.id, values]
        }),
      )
      await onAnswer(formatted)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[560px] gap-0 overflow-hidden p-0"
        aria-describedby="agent-input-description"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          const answerControl = firstOptionRef.current ?? customAnswerRef.current
          answerControl?.focus()
        }}
      >
        <DialogHeader className="border-b border-border px-5 py-4 pr-12">
          <DialogTitle>{question.header || "Agent needs input"}</DialogTitle>
          <DialogDescription id="agent-input-description">
            Question {questionIndex + 1} of {request.questions.length}.{" "}
            {isContinuation
              ? "This answer continues as a normal user turn."
              : "The originating run remains paused until you answer, skip, or cancel it."}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto px-5 py-4">
          <fieldset disabled={submitting}>
            <legend className="mb-4 text-sm font-medium text-foreground">
              {question.question}
            </legend>
            <div className="space-y-2">
              {question.options.map((option, optionIndex) => {
                const checked = selected.includes(option.id)
                return (
                  <label
                    key={option.label}
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

            {question.allowCustom && (
              <label className="mt-4 block text-xs font-medium text-muted-foreground">
                Custom answer
                <textarea
                  ref={customAnswerRef}
                  value={custom}
                  onChange={(event) => updateCustom(event.target.value)}
                  rows={3}
                  maxLength={4_000}
                  placeholder="Type another answer"
                  className="mt-1 w-full resize-y rounded-lg border border-border bg-background p-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
                />
              </label>
            )}
            {question.multiSelect && custom && (
              <p className="mt-1 text-xs text-muted-foreground">
                Custom text will be added to the selected choices.
              </p>
            )}
          </fieldset>
        </div>

        <DialogFooter className="flex-row items-center justify-between border-t border-border px-5 py-4 sm:justify-between sm:space-x-0">
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onAnswerInChat} disabled={submitting}>
              Answer in chat
            </Button>
            <Button variant="ghost" onClick={onSkip} disabled={submitting}>
              Skip all
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              aria-label="Previous question"
              disabled={questionIndex === 0 || submitting}
              onClick={() => setQuestionIndex((index) => Math.max(0, index - 1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            {questionIndex < request.questions.length - 1 ? (
              <Button
                onClick={() => setQuestionIndex((index) => index + 1)}
                disabled={submitting || (selected.length === 0 && !custom.trim())}
              >
                Next <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            ) : (
              <Button onClick={submit} disabled={!allAnswered || submitting}>
                {submitting ? "Sending..." : "Submit"}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
