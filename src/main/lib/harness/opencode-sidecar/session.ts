/**
 * OpenCode sidecar run orchestrator (Track E - E2/E4/E5/E6 glue).
 *
 * Ties launcher + client + event bridge + approval bridge into one async
 * generator of NormalizedSidecarEvents. The tRPC router maps these to
 * UIMessageChunks (via SidecarChunkMapper) and persists the run.
 *
 * The runtime is enabled by default once a user explicitly chooses an API
 * provider. Set `FLAPSTACK_OPENCODE_SIDECAR_ENABLED=0` to disable it for a
 * recovery/debug session.
 */

import { OpencodeClient } from "./client"
import { parseOpencodeModelString } from "./catalog"
import {
  buildOpencodePermissionApplication,
  buildOpencodeSessionPermissions,
  decideAutoApproval,
} from "./permissions"
import { eventSessionId, OpencodeEventNormalizer, parseSseChunk } from "./events"
import { startSidecar, stopSidecar, type SidecarHandle } from "./launcher"
import type {
  NormalizedSidecarEvent,
  SidecarApprovalCallback,
  SidecarLaunchInput,
  SidecarPermissionResolution,
} from "./contract"

export function isSidecarRuntimeEnabled(): boolean {
  return process.env.FLAPSTACK_OPENCODE_SIDECAR_ENABLED !== "0"
}

export function isStaleSidecarSessionError(error: unknown): boolean {
  return error instanceof Error && /session\.fork failed:\s*HTTP 404/i.test(error.message)
}

export function isAlreadyResolvedPermissionReplyError(error: unknown): boolean {
  return error instanceof Error && /permission reply failed:\s*HTTP 404/i.test(error.message)
}

const DEFAULT_EVENT_IDLE_TIMEOUT_MS = 120_000

export class SidecarEventIdleTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Provider event stream was idle for ${timeoutMs}ms.`)
    this.name = "SidecarEventIdleTimeoutError"
  }
}

async function readEventChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new SidecarEventIdleTimeoutError(timeoutMs)), timeoutMs)
        timer.unref?.()
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function permissionScopeKey(
  request: Extract<NormalizedSidecarEvent, { kind: "permission-asked" }>,
): string {
  return JSON.stringify([request.permission, [...request.patterns].sort()])
}

/**
 * Drive one sidecar run. Yields normalized events until the session goes idle,
 * errors, or is cancelled. Approval requests are routed through `onApproval`
 * unless the permission mode resolves them unambiguously.
 */
export async function* runSidecarSession(
  input: SidecarLaunchInput,
  onApproval?: SidecarApprovalCallback,
): AsyncGenerator<NormalizedSidecarEvent> {
  const permissionApplication = buildOpencodePermissionApplication({
    permissionMode: input.permissionMode,
    cwd: input.cwd,
    customPermissions: input.customPermissions,
  })
  // Make the applied controls and limitations part of the run stream so every
  // exit path, including runtime-disabled and preflight failure, can persist an honest record.
  yield { kind: "permission-application", application: permissionApplication }

  if (!isSidecarRuntimeEnabled()) {
    yield {
      kind: "error",
      errorText: "The provider runtime is disabled by the current environment configuration.",
    }
    yield { kind: "done" }
    return
  }

  const model = parseOpencodeModelString(input.model)
  if (model.providerId !== input.provider || !model.modelId) {
    yield {
      kind: "error",
      errorText: `Model ${input.model} does not belong to the ${input.provider} provider.`,
    }
    yield { kind: "done" }
    return
  }

  yield { kind: "phase", phase: "starting-server" }
  const started = await startSidecar({
    provider: input.provider,
    modelId: model.modelId,
    reasoningEnabled: input.reasoningEnabled,
    reasoningEffort: input.reasoningEffort,
    reasoningSupported: input.reasoningSupported,
    cwd: input.cwd,
    ...(input.signal ? { signal: input.signal } : {}),
    ...(input.productMcp ? { productMcp: input.productMcp } : {}),
  })
  if (!started.ok) {
    yield {
      kind: "error",
      errorText: `${started.limitation.message} - ${started.limitation.remedy}`,
    }
    yield { kind: "done" }
    return
  }

  const handle = started.handle
  const client = new OpencodeClient({
    baseUrl: handle.baseUrl,
    directory: handle.directory,
    password: handle.password,
  })

  try {
    yield { kind: "phase", phase: "awaiting-health" }
    await client.waitForHealth(20_000, input.signal)

    yield { kind: "phase", phase: "creating-session" }
    const permission = buildOpencodeSessionPermissions(
      input.permissionMode,
      input.customPermissions,
    )
    let sessionId: string | null = null
    if (input.resumeSessionId) {
      try {
        sessionId = await client.forkSession(input.resumeSessionId, input.signal)
        await client.setSessionPermissions(sessionId, permission, input.signal)
      } catch (error) {
        // Stale session id (sidecar restarted or storage reset) - start fresh        // instead of failing the whole run with a 404.
        if (isStaleSidecarSessionError(error)) {
          sessionId = null
        } else {
          throw error
        }
      }
    }
    if (!sessionId) sessionId = await client.createSession(permission, input.signal)
    yield { kind: "session-start", sessionId }

    yield { kind: "phase", phase: "streaming" }
    // Subscribe before prompting. Otherwise short provider responses can finish
    // before the SSE connection exists and their events are lost.
    const eventResponse = await client.openEventStream(input.signal)
    // The synchronous /message endpoint waits for the whole tool loop. That
    // deadlocks ask-mode runs because permission requests arrive over SSE while
    // the POST is still waiting. prompt_async returns once the run is queued.
    await client.promptAsync(sessionId, input.prompt, model, input.attachments, input.signal)
    yield* streamEvents({ client, handle, sessionId, input, onApproval, eventResponse })
    yield { kind: "done" }
  } catch (error) {
    yield {
      kind: "error",
      errorText: error instanceof Error ? error.message : String(error),
    }
    yield { kind: "done" }
  } finally {
    handle.stop()
    yield { kind: "phase", phase: "done" }
  }
}

export async function* streamEvents(ctx: {
  client: OpencodeClient
  handle: SidecarHandle
  sessionId: string
  input: SidecarLaunchInput
  onApproval?: SidecarApprovalCallback
  eventResponse: Response
  eventIdleTimeoutMs?: number
}): AsyncGenerator<NormalizedSidecarEvent> {
  const { client, sessionId, input, onApproval } = ctx
  const resp = ctx.eventResponse
  const body = resp.body
  if (!body) {
    yield { kind: "error", errorText: "The provider event stream returned no data." }
    return
  }

  const reader = body.getReader()
  const decoder = new TextDecoder()
  const seenPermissions = new Set<string>()
  const alwaysApprovals = new Map<string, SidecarPermissionResolution>()
  const normalizer = new OpencodeEventNormalizer()
  let buffer = ""
  let sawTerminalEvent = false
  const generationByObservation = new Map<string, string>()

  try {
    while (true) {
      if (input.signal?.aborted) {
        await client.abort(sessionId)
        break
      }
      let result: ReadableStreamReadResult<Uint8Array>
      try {
        result = await readEventChunk(
          reader,
          ctx.eventIdleTimeoutMs ?? DEFAULT_EVENT_IDLE_TIMEOUT_MS,
        )
      } catch (error) {
        if (!(error instanceof SidecarEventIdleTimeoutError)) throw error
        await client.abort(sessionId).catch(() => undefined)
        sawTerminalEvent = true
        yield { kind: "error", errorText: error.message }
        return
      }
      const { done, value } = result
      if (done) break
      const parsed = parseSseChunk(buffer, decoder.decode(value, { stream: true }))
      buffer = parsed.buffer

      for (const sse of parsed.events) {
        let data: Record<string, unknown>
        try {
          data = JSON.parse(sse.data) as Record<string, unknown>
        } catch {
          continue
        }
        const sid = eventSessionId(data)
        // Child agents share this isolated sidecar and event stream. Ignore their
        // prose/tool events, but bridge their permission requests or the parent
        // task waits forever with no approval UI.
        const isNestedPermission = data.type === "permission.asked" && sid !== sessionId
        if (sid && sid !== sessionId && !isNestedPermission) continue

        for (const rawNormalized of normalizer.normalize(data)) {
          const normalized =
            rawNormalized.kind === "usage" && input.provider === "openrouter"
              ? attachGenerationId(rawNormalized, ctx.handle, generationByObservation)
              : rawNormalized
          if (normalized.kind === "permission-asked") {
            if (seenPermissions.has(normalized.requestId)) continue
            seenPermissions.add(normalized.requestId)
            const scopeKey = permissionScopeKey(normalized)
            const remembered = alwaysApprovals.get(scopeKey)
            // OpenCode's "always" reply can resolve equivalent requests that
            // were already queued. Reuse that exact user decision instead of
            // showing a duplicate approval that now has a stale request id.
            if (!remembered) yield normalized
            const resolution = await handlePermissionRequest(
              client,
              input,
              onApproval,
              normalized,
              remembered,
            )
            if (resolution.decision.reply === "always") {
              alwaysApprovals.set(scopeKey, resolution)
            }
            yield {
              kind: "permission-decision",
              requestId: normalized.requestId,
              toolCallId: normalized.toolCallId,
              permission: normalized.permission,
              patterns: normalized.patterns,
              reply: resolution.decision.reply,
              replyStatus: resolution.replyStatus,
              ...(resolution.decision.reply === "reject"
                ? { message: resolution.decision.message }
                : {}),
              source: resolution.source,
            }
            continue
          }
          yield normalized
          if (normalized.kind === "idle") {
            sawTerminalEvent = true
            return
          }
          if (normalized.kind === "error") sawTerminalEvent = true
        }
      }
    }
    if (!input.signal?.aborted && !sawTerminalEvent) {
      yield {
        kind: "error",
        errorText: "The provider event stream ended before the run completed.",
      }
    }
  } finally {
    reader.releaseLock()
  }
}

function attachGenerationId(
  event: Extract<NormalizedSidecarEvent, { kind: "usage" }>,
  handle: SidecarHandle,
  byObservation: Map<string, string>,
): Extract<NormalizedSidecarEvent, { kind: "usage" }> {
  const observation = event.usage.observationId ?? "latest"
  const generationId =
    event.usage.generationId ?? byObservation.get(observation) ?? handle.takeGenerationId()
  if (!generationId) return event
  byObservation.set(observation, generationId)
  return { ...event, usage: { ...event.usage, generationId } }
}

export async function handlePermissionRequest(
  client: OpencodeClient,
  input: SidecarLaunchInput,
  onApproval: SidecarApprovalCallback | undefined,
  request: Extract<NormalizedSidecarEvent, { kind: "permission-asked" }>,
  remembered?: SidecarPermissionResolution,
): Promise<SidecarPermissionResolution> {
  const auto = decideAutoApproval(
    input.permissionMode,
    request.permission,
    request.patterns,
    request.requestId,
    input.customPermissions,
    Boolean(input.productMcp),
  )
  const resolution: Omit<SidecarPermissionResolution, "replyStatus"> =
    remembered ??
    (auto
      ? { decision: auto, source: "policy" }
      : onApproval
        ? {
            decision: await onApproval({
              requestId: request.requestId,
              toolCallId: request.toolCallId,
              permission: request.permission,
              patterns: request.patterns,
              ...(request.command ? { command: request.command } : {}),
            }),
            source: "user",
          }
        : {
            decision: { reply: "reject", message: "No approval handler available." },
            source: "fallback",
          })
  const decision = resolution.decision

  try {
    if (decision.reply === "reject") {
      if (input.signal)
        await client.replyPermission(request.requestId, "reject", decision.message, input.signal)
      else await client.replyPermission(request.requestId, "reject", decision.message)
    } else {
      if (input.signal)
        await client.replyPermission(request.requestId, decision.reply, undefined, input.signal)
      else await client.replyPermission(request.requestId, decision.reply)
    }
  } catch (error) {
    // OpenCode removes permission requests after they expire and can also remove
    // equivalent queued requests after an "always" reply. A late reply then gets
    // a 404 even though the provider run is still valid. Keep consuming the run
    // and record that the decision was not applied to a pending request.
    if (!isAlreadyResolvedPermissionReplyError(error)) throw error
    return { ...resolution, replyStatus: "no-longer-pending" }
  }
  return { ...resolution, replyStatus: "applied" }
}
