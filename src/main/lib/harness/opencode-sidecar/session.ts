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
  if (!isSidecarRuntimeEnabled()) {
    yield {
      kind: "error",
      errorText: "OpenCode sidecar runtime is disabled by FLAPSTACK_OPENCODE_SIDECAR_ENABLED=0.",
    }
    yield { kind: "done" }
    return
  }

  // Compute the session rules up front. The persisted run wiring will record the
  // matching permission application when this scaffolding is made live.
  buildOpencodePermissionApplication({
    permissionMode: input.permissionMode,
    cwd: input.cwd,
  })

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
      ? await client.forkSession(input.resumeSessionId)
      : await client.createSession(permission)
    if (input.resumeSessionId) await client.setSessionPermissions(sessionId, permission)
    yield { kind: "session-start", sessionId }

    yield { kind: "phase", phase: "streaming" }
    // Subscribe before prompting. Otherwise short provider responses can finish
    // before the SSE connection exists and their events are lost.
    const eventResponse = await client.openEventStream(input.signal)
    await client.prompt(sessionId, input.prompt, model, input.attachments)
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

async function* streamEvents(ctx: {
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

        for (const normalized of normalizer.normalize(data)) {
          if (normalized.kind === "permission-asked") {
            if (seenPermissions.has(normalized.requestId)) continue
            seenPermissions.add(normalized.requestId)
            // Surface the request in the run for auditing.
            yield normalized
            await handlePermission(client, input, onApproval, normalized)
            continue
          }
          yield normalized
          if (normalized.kind === "idle") return
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

async function handlePermission(
  client: OpencodeClient,
  input: SidecarLaunchInput,
  onApproval: SidecarApprovalCallback | undefined,
  request: Extract<NormalizedSidecarEvent, { kind: "permission-asked" }>,
): Promise<void> {
  const auto = decideAutoApproval(input.permissionMode, request.permission)
  const decision =
    auto ??
    (onApproval
      ? await onApproval({
          requestId: request.requestId,
          toolCallId: request.toolCallId,
          permission: request.permission,
        })
      : { reply: "reject" as const, message: "No approval handler available." })

  if (decision.reply === "reject") {
    await client.replyPermission(request.requestId, "reject", decision.message)
  } else {
    await client.replyPermission(request.requestId, decision.reply)
  }
}
