/**
 * OpenCode sidecar run orchestrator (Track E — E2/E4/E5/E6 glue).
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
  })
  // Make the applied controls and limitations part of the run stream so every
  // exit path, including runtime-disabled and preflight failure, can persist an honest record.
  yield { kind: "permission-application", application: permissionApplication }

  if (!isSidecarRuntimeEnabled()) {
    yield {
      kind: "error",
      errorText: "OpenCode sidecar runtime is disabled by FLAPSTACK_OPENCODE_SIDECAR_ENABLED=0.",
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
    cwd: input.cwd,
    ...(input.signal ? { signal: input.signal } : {}),
  })
  if (!started.ok) {
    yield {
      kind: "error",
      errorText: `${started.limitation.message} — ${started.limitation.remedy}`,
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
    const permission = buildOpencodeSessionPermissions(input.permissionMode)
    const sessionId = input.resumeSessionId
      ? await client.forkSession(input.resumeSessionId, input.signal)
      : await client.createSession(permission, input.signal)
    if (input.resumeSessionId)
      await client.setSessionPermissions(sessionId, permission, input.signal)
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
}): AsyncGenerator<NormalizedSidecarEvent> {
  const { client, sessionId, input, onApproval } = ctx
  const resp = ctx.eventResponse
  const body = resp.body
  if (!body) {
    yield { kind: "error", errorText: "OpenCode event stream returned no body." }
    return
  }

  const reader = body.getReader()
  const decoder = new TextDecoder()
  const seenPermissions = new Set<string>()
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
      const { done, value } = await reader.read()
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
        if (sid && sid !== sessionId) continue

        for (const rawNormalized of normalizer.normalize(data)) {
          const normalized =
            rawNormalized.kind === "usage" && input.provider === "openrouter"
              ? attachGenerationId(rawNormalized, ctx.handle, generationByObservation)
              : rawNormalized
          if (normalized.kind === "permission-asked") {
            if (seenPermissions.has(normalized.requestId)) continue
            seenPermissions.add(normalized.requestId)
            // Surface the request in the run for auditing.
            yield normalized
            const resolution = await handlePermissionRequest(client, input, onApproval, normalized)
            yield {
              kind: "permission-decision",
              requestId: normalized.requestId,
              toolCallId: normalized.toolCallId,
              permission: normalized.permission,
              patterns: normalized.patterns,
              reply: resolution.decision.reply,
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
        errorText: "OpenCode event stream ended before the run reached a terminal state.",
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
): Promise<SidecarPermissionResolution> {
  const auto = decideAutoApproval(input.permissionMode, request.permission)
  const resolution: SidecarPermissionResolution = auto
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
        }
  const decision = resolution.decision

  if (decision.reply === "reject") {
    if (input.signal)
      await client.replyPermission(request.requestId, "reject", decision.message, input.signal)
    else await client.replyPermission(request.requestId, "reject", decision.message)
  } else {
    if (input.signal)
      await client.replyPermission(request.requestId, decision.reply, undefined, input.signal)
    else await client.replyPermission(request.requestId, decision.reply)
  }
  return resolution
}
