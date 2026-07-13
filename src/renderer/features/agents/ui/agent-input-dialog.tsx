"use client"

import { useEffect, useMemo, useState } from "react"
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
  onAnswer: (answers: Record<string, string>) => void | Promise<void>
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

  useEffect(() => {
    setQuestionIndex(0)
    setAnswers({})
    setCustomAnswers({})
    setSubmitting(false)
  }, [request.toolUseId])

  const question = request.questions[questionIndex]
  const allAnswered = useMemo(
    () =>
      request.questions.every((item) => {
        const selected = answers[item.question] ?? []
        return selected.length > 0 || Boolean(customAnswers[item.question]?.trim())
      }),
    [answers, customAnswers, request.questions],
  )

  if (!question) return null

  const selected = answers[question.question] ?? []
  const custom = customAnswers[question.question] ?? ""
  const chooseOption = (label: string) => {
    setAnswers((current) => {
      const prior = current[question.question] ?? []
      return {
        ...current,
        [question.question]: question.multiSelect
          ? prior.includes(label)
            ? prior.filter((value) => value !== label)
            : [...prior, label]
          : [label],
      }
    })
    if (!question.multiSelect) {
      setCustomAnswers((current) => ({ ...current, [question.question]: "" }))
    }
  }

  const updateCustom = (value: string) => {
    setCustomAnswers((current) => ({ ...current, [question.question]: value }))
    if (!question.multiSelect && value) {
      setAnswers((current) => ({ ...current, [question.question]: [] }))
    }
  }

  const submit = async () => {
    if (!allAnswered || submitting) return
    setSubmitting(true)
    try {
      const formatted = Object.fromEntries(
        request.questions.map((item) => {
          const values = [...(answers[item.question] ?? [])]
          const customValue = customAnswers[item.question]?.trim()
          if (customValue) values.push(`Other: ${customValue}`)
          return [item.question, values.join(", ")]
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
      >
        <DialogHeader className="border-b border-border px-5 py-4 pr-12">
          <DialogTitle>{question.header || "Agent needs input"}</DialogTitle>
          <DialogDescription id="agent-input-description">
            Question {questionIndex + 1} of {request.questions.length}. The originating run remains
            paused until you answer, skip, or cancel it.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto px-5 py-4">
          <fieldset disabled={submitting}>
            <legend className="mb-4 text-sm font-medium text-foreground">
              {question.question}
            </legend>
            <div className="space-y-2">
              {question.options.map((option) => {
                const checked = selected.includes(option.label)
                return (
                  <label
                    key={option.label}
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
                      checked ? "border-foreground/40 bg-muted" : "border-border hover:bg-muted/50",
                    )}
                  >
                    <input
                      type={question.multiSelect ? "checkbox" : "radio"}
                      name={`agent-input-${request.toolUseId}-${questionIndex}`}
                      checked={checked}
                      onChange={() => chooseOption(option.label)}
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

            <label className="mt-4 block text-xs font-medium text-muted-foreground">
              Custom answer
              <textarea
                value={custom}
                onChange={(event) => updateCustom(event.target.value)}
                rows={3}
                maxLength={4_000}
                placeholder="Type another answer"
                className="mt-1 w-full resize-y rounded-lg border border-border bg-background p-3 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
              />
            </label>
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
