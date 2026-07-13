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
