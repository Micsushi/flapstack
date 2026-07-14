import type {
  PermissionOption,
  RequestPermissionRequest,
  RequestPermissionResponse,
} from "@agentclientprotocol/sdk"
import { CODEX_PERMISSION_TIMEOUT_MS } from "../../../shared/harness-types"

export type CodexPermissionDecision = {
  promise: Promise<RequestPermissionResponse>
  resolve: (response: RequestPermissionResponse) => void
  reject: () => void
}

type PendingCodexPermissionRequest = {
  subChatId: string
  runId: string
  request: RequestPermissionRequest
  resolve: (response: RequestPermissionResponse) => void
}

const pendingCodexPermissionRequests = new Map<string, PendingCodexPermissionRequest>()

export function summarizeCodexPermissionRequest(input: {
  requestId: string
  subChatId: string
  runId: string
  request: RequestPermissionRequest
}) {
  return {
    requestId: input.requestId,
    subChatId: input.subChatId,
    runId: input.runId,
    toolCallId: input.request.toolCall.toolCallId,
    title: input.request.toolCall.title ?? "Codex tool",
    kind: input.request.toolCall.kind ?? "other",
    options: input.request.options.map((option) => ({
      optionId: option.optionId,
      name: option.name,
      kind: option.kind,
    })),
  }
}

export function registerPendingCodexPermissionRequest(
  requestId: string,
  pending: PendingCodexPermissionRequest,
): void {
  pendingCodexPermissionRequests.set(requestId, pending)
}

export function removePendingCodexPermissionRequest(requestId: string): void {
  pendingCodexPermissionRequests.delete(requestId)
}

export function listPendingCodexPermissionRequests(input?: { runId?: string }) {
  return [...pendingCodexPermissionRequests.entries()]
    .filter(([, pending]) => !input?.runId || pending.runId === input.runId)
    .map(([requestId, pending]) =>
      summarizeCodexPermissionRequest({
        requestId,
        subChatId: pending.subChatId,
        runId: pending.runId,
        request: pending.request,
      }),
    )
}

export function replyPendingCodexPermissionRequest(input: {
  requestId: string
  optionId: string
}): { resolved: boolean } {
  const pending = pendingCodexPermissionRequests.get(input.requestId)
  if (!pending) return { resolved: false }
  pendingCodexPermissionRequests.delete(input.requestId)
  pending.resolve(resolveCodexPermissionOption(pending.request, input.optionId))
  return { resolved: true }
}

export function rejectPendingCodexPermissionRequests(subChatId: string, runId?: string): void {
  for (const [requestId, pending] of pendingCodexPermissionRequests) {
    if (pending.subChatId !== subChatId || (runId && pending.runId !== runId)) continue
    pendingCodexPermissionRequests.delete(requestId)
    pending.resolve(rejectCodexPermissionRequest(pending.request))
  }
}

export function rejectCodexPermissionRequest(
  request: Pick<RequestPermissionRequest, "options">,
): RequestPermissionResponse {
  const rejectOption = findRejectOption(request.options)
  return rejectOption
    ? { outcome: { outcome: "selected", optionId: rejectOption.optionId } }
    : { outcome: { outcome: "cancelled" } }
}

export function allowCodexPermissionRequest(
  request: Pick<RequestPermissionRequest, "options">,
): RequestPermissionResponse {
  const allowOption = findAllowOption(request.options)
  return allowOption
    ? { outcome: { outcome: "selected", optionId: allowOption.optionId } }
    : { outcome: { outcome: "cancelled" } }
}

export function createCodexPermissionDecision(params: {
  request: Pick<RequestPermissionRequest, "options">
  signal: AbortSignal
  timeoutMs?: number
}): CodexPermissionDecision {
  let settle: (response: RequestPermissionResponse) => void = () => {}
  const promise = new Promise<RequestPermissionResponse>((resolve) => {
    settle = resolve
  })
  let settled = false
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const settleOnce = (response: RequestPermissionResponse) => {
    if (settled) return
    settled = true
    if (timeoutId) clearTimeout(timeoutId)
    params.signal.removeEventListener("abort", reject)
    settle(response)
  }
  const reject = () => settleOnce(rejectCodexPermissionRequest(params.request))
  timeoutId = setTimeout(reject, params.timeoutMs ?? CODEX_PERMISSION_TIMEOUT_MS)

  params.signal.addEventListener("abort", reject, { once: true })
  if (params.signal.aborted) reject()

  return { promise, resolve: settleOnce, reject }
}

export function resolveCodexPermissionOption(
  request: Pick<RequestPermissionRequest, "options">,
  optionId: string,
): RequestPermissionResponse {
  const selected = request.options.find((option) => option.optionId === optionId)
  return selected
    ? { outcome: { outcome: "selected", optionId: selected.optionId } }
    : rejectCodexPermissionRequest(request)
}

export function findRejectOption(options: PermissionOption[]): PermissionOption | null {
  return (
    options.find((option) => option.kind === "reject_once") ??
    options.find((option) => option.kind === "reject_always") ??
    null
  )
}

export function findAllowOption(options: PermissionOption[]): PermissionOption | null {
  return (
    options.find((option) => option.kind === "allow_once") ??
    options.find((option) => option.kind === "allow_always") ??
    null
  )
}
