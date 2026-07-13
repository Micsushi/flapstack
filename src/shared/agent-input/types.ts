import type { HarnessProvider } from "../harness-types"

export const AGENT_INPUT_CAPABILITY_MODES = [
  "native",
  "injected-tool",
  "continuation",
  "unsupported",
] as const

export type AgentInputCapabilityMode = (typeof AGENT_INPUT_CAPABILITY_MODES)[number]

export const AGENT_INPUT_STATUSES = [
  "pending",
  "submitting",
  "answered",
  "skipped",
  "cancelled",
  "expired",
  "interrupted",
] as const

export type AgentInputStatus = (typeof AGENT_INPUT_STATUSES)[number]
export type AgentInputResponseMode = "structured" | "chat"

export interface AgentInputOption {
  id: string
  label: string
  description?: string
}

export interface AgentInputQuestion {
  id: string
  question: string
  header?: string
  options: AgentInputOption[]
  multiSelect: boolean
  allowCustom: boolean
}

export interface AgentInputCapability {
  mode: AgentInputCapabilityMode
  sameRun: boolean
  limitation?: string
}

export interface AgentInputOrigin {
  harness: HarnessProvider
  provider?: string
  model?: string
  toolName?: string
}

export interface AgentInputRequest {
  requestId: string
  chatId: string
  runId: string
  origin: AgentInputOrigin
  capability: AgentInputCapability
  questions: AgentInputQuestion[]
  status: "pending"
  createdAt: number
  expiresAt?: number
}

export interface AgentInputResponse {
  requestId: string
  mode: AgentInputResponseMode
  answers: Record<string, string[]>
  submittedAt: number
}

export type AgentInputResolution =
  | { status: "answered"; response: AgentInputResponse }
  | { status: Exclude<AgentInputStatus, "pending" | "submitting" | "answered">; message: string }

export interface AgentInputStatusEvent {
  requestId: string
  chatId: string
  runId: string
  status: AgentInputStatus
  at: number
  response?: AgentInputResponse
  message?: string
}

export function formatAgentInputQuestions(request: Pick<AgentInputRequest, "questions">): string {
  return request.questions.map((question, index) => `${index + 1}. ${question.question}`).join("\n")
}
