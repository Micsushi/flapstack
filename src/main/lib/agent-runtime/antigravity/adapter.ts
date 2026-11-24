import {
  ClientSideConnection,
  ndJsonStream,
  RequestError,
  type ClientCapabilities,
  type ContentBlock,
  type RequestPermissionRequest,
} from "@agentclientprotocol/sdk"
import { execFile, spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { delimiter, isAbsolute, join } from "node:path"
import { PassThrough, Readable, Writable } from "node:stream"
import { setTimeout as delay } from "node:timers/promises"
import { promisify } from "node:util"
import type { AgentActivityAppend } from "../../../../shared/agent-activity"
import type {
  HarnessAdapter,
  RuntimeAdapterContext,
  RuntimeAdapterProbe,
  RuntimeAdapterSession,
} from "../../../../shared/agent-runtime"
import { eventRecord } from "../event-values"
import { sanitizeRuntimeText } from "../sanitizer"
import { AntigravityEvents } from "./events"
import { answerAntigravityForm, type AskAntigravityQuestion } from "./questions"
import { antigravityPermissions } from "../../../../shared/antigravity-permissions"

function executable() {
  const name = process.platform === "win32" ? "agy.exe" : "agy"
  for (const dir of [
    join(homedir(), ".local", "bin"),
    ...(process.env.PATH ?? "").split(delimiter),
  ]) {
    if (isAbsolute(dir) && existsSync(join(dir, name))) return join(dir, name)
  }
  throw new Error("Install Antigravity CLI and sign in with agy before starting this chat.")
}

type ModelOption = { id: string; name: string }
let catalog: { expires: number; value: Promise<ModelOption[]> } | undefined

export function antigravityModels(): Promise<ModelOption[]> {
  if (catalog && Date.now() < catalog.expires) return catalog.value
  const value = fetchModels().catch((error) => {
    if (catalog?.value === value) catalog = undefined
    throw error
  })
  catalog = { expires: Date.now() + 30_000, value }
  return value
}

async function fetchModels() {
  const { stdout } = await promisify(execFile)(executable(), ["models"], {
    windowsHide: true,
    timeout: 12_000,
    maxBuffer: 256_000,
  }).catch((cause) => {
    throw new Error(
      "Antigravity could not list Gemini models. Check your CLI sign-in and refresh the list.",
      { cause },
    )
  })
  const models = stdout.split(/\r?\n/).flatMap((line) => {
    const [id, name] = line.trim().split("\t")
    // Third-party models are restricted to specific ACP clients by Antigravity.
    return id?.startsWith("gemini-") && name ? [{ id, name }] : []
  })
  if (!models.length)
    throw new Error("Antigravity returned no available models. Check your CLI sign-in.")
  return models
}

type Dependencies = {
  cwd: (context: RuntimeAdapterContext) => string
  images: (runId: string) => Array<{ base64Data: string; mediaType: string }>
  append: (runId: string, events: AgentActivityAppend[]) => Promise<void>
  permission: (runId: string, request: unknown) => Promise<unknown>
  ask: AskAntigravityQuestion
}

export function antigravityError(operation: string, cause: unknown): Error {
  const outer = eventRecord(cause)
  const error = outer.error && typeof outer.error === "object" ? eventRecord(outer.error) : outer
  const code =
    typeof error.code === "number" && Number.isSafeInteger(error.code) ? error.code : null
  const message = typeof cause === "string" ? cause : error.message
  const detail =
    typeof message === "string" && message.trim() && message !== "[object Object]"
      ? sanitizeRuntimeText(message.trim(), { mode: "diagnostic", maxLength: 500 })
      : code === -32000
        ? "Authentication required."
        : code === -32002
          ? "Requested resource not found."
          : "The provider supplied no readable error message."
  return new Error(
    `Antigravity failed during ${operation}${code === null ? "" : ` (ACP ${code})`}. ${detail}`,
  )
}

/** An internal rejection during newSession is before any user prompt or tool dispatch. */
export async function createAntigravitySession<T>(create: () => Promise<T>, signal: AbortSignal) {
  signal.throwIfAborted()
  try {
    return await create()
  } catch (cause) {
    const outer = eventRecord(cause)
    const error = outer.error && typeof outer.error === "object" ? eventRecord(outer.error) : outer
    if (
      signal.aborted ||
      error.code !== -32603 ||
      error.message !== "Failed to start Antigravity conversation" ||
      error.data != null
    )
      throw cause
    await delay(200, undefined, { signal })
    return create()
  }
}

const ACP_REQUEST_TIMEOUT_MS = 15_000
async function bounded<T>(
  action: Promise<T>,
  label: string,
  timeout = ACP_REQUEST_TIMEOUT_MS,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      action,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("The provider did not respond before the timeout.")),
          timeout,
        )
      }),
    ])
  } catch (cause) {
    throw antigravityError(label, cause)
  } finally {
    clearTimeout(timer)
  }
}

function connect(context: RuntimeAdapterContext, deps: Dependencies) {
  const cwd = deps.cwd(context)
  const permissions = antigravityPermissions(context.launch.permission.mode)
  if (!permissions.applied) throw new Error(permissions.reason)
  const args =
    context.launch.controls.antigravityNativeApprovals === true
      ? ["acp"]
      : ["acp", "--dangerously-skip-permissions"]
  const child = spawn(executable(), args, {
    cwd,
    windowsHide: true,
    stdio: ["pipe", "pipe", "ignore"],
  })
  const events = new PassThrough({ objectMode: true })
  // An early process failure may precede attachment of the activity iterator.
  events.on("error", () => {})
  const state = {
    child,
    events,
    sessionId: "",
    mapper: null as AntigravityEvents | null,
    prompt: "",
    collecting: false,
    completed: false,
  }
  function stop(error: Error) {
    events.destroy(error)
    child.kill()
  }
  child.once("error", stop)
  child.once("exit", (code, signal) => {
    if (!events.writableEnded && !events.destroyed)
      events.destroy(new Error(`Antigravity exited (${signal ?? code ?? "unknown"}).`))
  })
  const connection = new ClientSideConnection(
    () => ({
      async sessionUpdate({ sessionId, update }) {
        if (!state.collecting || state.sessionId !== sessionId || !state.mapper) return
        try {
          for (const event of state.mapper.update(update)) events.write(event)
        } catch (error) {
          stop(antigravityError("activity processing", error))
        }
      },
      async extMethod(method, params) {
        if (method !== "elicitation/create") throw RequestError.methodNotFound(method)
        if (params.sessionId !== state.sessionId || !state.collecting) return { action: "cancel" }
        return answerAntigravityForm(context, params, deps.ask)
      },
      async requestPermission(request: RequestPermissionRequest) {
        const cancelled = { outcome: { outcome: "cancelled" as const } }
        if (request.sessionId !== state.sessionId || !state.collecting || context.signal.aborted)
          return cancelled
        const { toolCall, options } = request
        const allowOnce = options.find((option) => option.kind === "allow_once")
        if (!allowOnce) return cancelled
        const input = eventRecord(toolCall.rawInput)
        const path = toolCall.locations?.[0]?.path ?? input.Path
        const result = await deps.permission(context.runId, {
          provider: "antigravity",
          toolName: toolCall.title || toolCall.kind || "Antigravity tool",
          toolInput: { file_path: path, command: input.CommandLine },
          params: { cwd },
        })
        if (context.signal.aborted || !state.collecting || state.sessionId !== request.sessionId)
          return cancelled
        const decision = eventRecord(result)
        const allowed = decision.decision === "accept"
        const selected = allowed
          ? allowOnce
          : options.find((option) => option.kind === "reject_once")
        state.mapper?.setFileChangeDeclined(
          toolCall,
          selected?.kind === "reject_once" && decision.userDeclined === true,
        )
        return selected
          ? { outcome: { outcome: "selected" as const, optionId: selected.optionId } }
          : cancelled
      },
    }),
    ndJsonStream(
      Writable.toWeb(child.stdin),
      Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
    ),
  )
  return { state, connection, cwd }
}

export function createAntigravityAdapter(deps: Dependencies): HarnessAdapter<AgentActivityAppend> {
  const runs = new Map<string, ReturnType<typeof connect>>()
  async function open(context: RuntimeAdapterContext, previous?: RuntimeAdapterSession) {
    if (context.outputSchema)
      throw new Error("Antigravity ACP does not support structured result schemas.")
    const run = connect(context, deps)
    runs.set(context.runId, run)
    const { state, connection, cwd } = run
    // SDK 0.14.1 forwards draft ACP capabilities and requests through extMethod.
    const clientCapabilities: ClientCapabilities & { elicitation: { form: object } } = {
      elicitation: { form: {} },
    }
    const init = await bounded(
      connection.initialize({
        protocolVersion: 1,
        clientCapabilities,
        clientInfo: { name: "Flapstack", version: "1" },
      }),
      "initialization",
    )
    if (init.protocolVersion !== 1)
      throw new Error("Antigravity returned an incompatible ACP version.")
    if (previous && !previous.providerSessionId)
      throw new Error("Cannot resume Antigravity without its saved session ID.")
    const session = previous?.providerSessionId
      ? await bounded(
          connection.unstable_resumeSession({
            sessionId: previous.providerSessionId,
            cwd,
            mcpServers: [],
          }),
          "resume",
        )
      : await bounded(
          createAntigravitySession(
            () => connection.newSession({ cwd, mcpServers: [] }),
            AbortSignal.any([context.signal, AbortSignal.timeout(ACP_REQUEST_TIMEOUT_MS)]),
          ),
          "session setup",
        )
    const sessionId =
      previous?.providerSessionId || ("sessionId" in session && String(session.sessionId))
    if (!sessionId) throw new Error("Antigravity returned no session ID.")
    state.sessionId = sessionId
    state.mapper = new AntigravityEvents(sessionId, context.launch.controls.reasoningDisplay)
    const selected = context.launch.model
    if (selected) {
      if (!selected.startsWith("gemini-"))
        throw new Error("Choose an available Gemini model for Antigravity.")
      await bounded(
        connection.unstable_setSessionModel({ sessionId, modelId: selected }),
        "model selection",
      )
    }
    await bounded(
      connection.setSessionMode({ sessionId, modeId: "default" }),
      "permission selection",
    )
    return { providerSessionId: sessionId, providerThreadId: null }
  }

  return {
    runtime: "flapstack-native",
    async probe(harness): Promise<RuntimeAdapterProbe> {
      let error: string | null = null
      try {
        if (harness !== "antigravity") throw new Error("Wrong harness for Antigravity.")
        await antigravityModels()
      } catch (cause) {
        error = antigravityError("availability check", cause).message
      }
      const reason = error
        ? {
            code: "runtime-unavailable" as const,
            message: error,
            harness,
            runtime: "flapstack-native" as const,
            repair: "Check Antigravity CLI installation and sign-in.",
          }
        : null
      return {
        harness,
        runtime: "flapstack-native",
        available: !reason,
        reason,
        versions: { adapterVersion: "1", protocolVersion: "acp/1" },
        capabilities: {
          schemaVersion: 1,
          status: reason ? "unavailable" : "available",
          capturedAt: new Date().toISOString(),
          controls: {
            modelThinking: {
              supported: false,
              reason:
                "Gemini effort is selected with the model. ACP has no separate thinking switch.",
            },
            reasoningDisplay: { supported: true, reason: null },
            subagentActivity: {
              supported: false,
              reason: "ACP exposes tool activity in the parent chat.",
            },
            hookDiagnostics: {
              supported: false,
              reason: "Antigravity ACP does not expose hook diagnostics.",
            },
          },
          execution: {
            continuation: { supported: !reason, reason: error },
            cancellation: { supported: !reason, reason: error },
            structuredOutput: {
              supported: false,
              reason: "Antigravity ACP cannot enforce a result schema.",
            },
            delegation: {
              supported: false,
              reason: "Delegation through Antigravity ACP is unverified.",
            },
          },
          limitations: [
            "Only Full access is supported. Native approval requests follow Antigravity's rules. Form questions support text, choices and yes/no answers.",
          ],
          unavailableReason: reason,
        },
      }
    },
    startSession: (context) => open(context),
    resumeSession: (context, session) => open(context, session),
    async startTurn(context, _session, prompt) {
      const run = runs.get(context.runId)
      if (!run) throw new Error("Antigravity session is unavailable.")
      run.state.prompt = prompt
      return { providerTurnId: null }
    },
    async *streamActivity(context) {
      const run = runs.get(context.runId)
      if (!run) throw new Error("Antigravity session is unavailable.")
      const { state, connection } = run
      state.collecting = true
      const prompt: ContentBlock[] = [{ type: "text", text: state.prompt }]
      for (const image of deps.images(context.runId))
        prompt.push({ type: "image", data: image.base64Data, mimeType: image.mediaType })
      // The durable turn has been recorded before the provider receives its prompt.
      let terminalError: Error | null = null
      let ended = false
      void connection
        .prompt({ sessionId: state.sessionId, prompt })
        .then((result) => {
          state.collecting = false
          terminalError =
            result.stopReason === "end_turn"
              ? state.mapper!.completionError()
              : new Error(`Antigravity ended the turn: ${result.stopReason}.`)
          for (const event of state.mapper!.finishTurn()) state.events.write(event)
          ended = true
        })
        .catch((error) => {
          terminalError = antigravityError("the turn", error)
        })
        .finally(() => {
          state.collecting = false
          state.events.end()
        })
      for await (const item of state.events) {
        const event = item as AgentActivityAppend
        await deps.append(context.runId, [event])
        yield event
      }
      // Drain already queued tool and reasoning events before reporting a failed turn.
      if (terminalError) throw terminalError
      state.completed = ended && !context.signal.aborted
    },
    async requestPermission(context, request) {
      return deps.permission(context.runId, request)
    },
    async requestInput(context, request) {
      const params = eventRecord(request)
      const run = runs.get(context.runId)
      if (!run?.state.collecting || params.sessionId !== run.state.sessionId)
        return { action: "cancel" }
      return answerAntigravityForm(context, params, deps.ask)
    },
    async cancel(context) {
      const run = runs.get(context.runId)
      if (!run) return
      try {
        if (run.state.sessionId)
          await bounded(
            run.connection.cancel({ sessionId: run.state.sessionId }),
            "cancellation",
            1000,
          )
      } finally {
        run.state.events.destroy()
        run.state.child.kill()
      }
    },
    async complete(context) {
      if (!runs.get(context.runId)?.state.completed)
        throw new Error("Antigravity has not completed this turn.")
    },
    async reconcile(context) {
      const state = runs.get(context.runId)?.state
      return state?.completed ? "completed" : state?.collecting ? "running" : "uncertain"
    },
    async cleanup(context) {
      const run = runs.get(context.runId)
      if (run) {
        run.state.events.destroy()
        run.state.child.stdin.end()
        run.state.child.kill()
        runs.delete(context.runId)
      }
    },
  }
}
