import { z } from "zod"

export const sideQuestionMessageSchema = z
  .object({
    id: z.string().min(1).max(200),
    role: z.enum(["user", "assistant"]),
    text: z.string().max(24_000),
  })
  .strict()
export const askSideQuestionSchema = z
  .object({
    subChatId: z.string().min(1).max(200),
    requestId: z.string().uuid(),
    threadId: z.string().uuid().optional(),
    question: z.string().trim().min(1).max(12_000),
    provider: z.enum(["codex", "claude", "ollama"]).optional(),
    model: z.string().trim().min(1).max(200).optional(),
    visibleContextTruncated: z.boolean().optional(),
    visibleMessages: z.array(sideQuestionMessageSchema).max(100).optional(),
  })
  .strict()
  .refine(
    (value) =>
      (value.visibleMessages?.reduce((n, message) => n + message.text.length, 0) ?? 0) <= 120_000,
    "Visible context is too long",
  )
export type AskSideQuestion = z.infer<typeof askSideQuestionSchema>
export type SideQuestionMessage = z.infer<typeof sideQuestionMessageSchema>
export type SideQuestion = {
  id: string
  subChatId: string
  threadId: string
  question: string
  answer: string
  status: "running" | "completed" | "failed" | "cancelled"
  error: string | null
  provider: "codex" | "claude" | "ollama"
  model: string | null
  createdAt: number
  updatedAt: number
  promotedChatId: string | null
}
