import {
  ClientSideConnection,
  ndJsonStream,
  RequestError,
  type ClientCapabilities,
  type InitializeResponse,
  type ContentBlock,
  type RequestPermissionRequest,
  type SessionConfigOption,
} from "@agentclientprotocol/sdk"
import { execFile, spawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import { existsSync, mkdtempSync } from "node:fs"
import { rmdir } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
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
import { childHarnessEnvironment } from "../../mcp-control/child-registration"
import {
  FLAPSTACK_MCP_SERVER_NAME,
  renameProductMcpServerCollisions,
  type McpStdioRegistration,
} from "../../mcp-control/registration"
import { projectMcpServers } from "./project-mcp"
import { AntigravityEvents } from "./events"
import { answerAntigravityForm, type AskAntigravityQuestion } from "./questions"
import {
  antigravityEffortVariants,
  type AntigravityModelOption,
} from "../../../../shared/antigravity-models"
import { REASONING_EFFORTS, type ReasoningEffort } from "../../../../shared/model-catalog"
import { providerProbeKey, ProviderProbeCache } from "../probe-cache"
import { antigravityPermissionDecision } from "./permissions"

export function resolveAntigravityBinary() {
  const name = process.platform === "win32" ? "agy.exe" : "agy"
  for (const dir of [
    join(homedir(), ".local", "bin"),
    ...(process.env.PATH ?? "").split(delimiter),
  ]) {
    if (isAbsolute(dir) && existsSync(join(dir, name))) return join(dir, name)
  }
  return null
}

function executable() {
  const binary = resolveAntigravityBinary()
  if (!binary) throw new Error("Install Antigravity CLI and sign in before starting this chat.")
  return binary
}

const catalog = new ProviderProbeCache<AntigravityModelOption[]>(30_000)
const cliCatalog = new ProviderProbeCache<AntigravityModelOption[]>(30_000)

export function supportsOpenAntigravityModels(version: string | null | undefined) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:$|\s|\+)/.exec(version?.trim() ?? "")
  if (!match) return false
  const [, major, minor, patch] = match.map(Number)
  return major! > 1 || (major === 1 && (minor! > 5 || (minor === 5 && patch! >= 1)))
}

export function antigravityModels(): Promise<AntigravityModelOption[]> {
  const command = executable()
  const key = providerProbeKey(command)
  return catalog
    .get(key, () => fetchModelCatalog(command))
    .catch(() => cliCatalog.get(key, () => fetchCliModelCatalog(command)))
}

async function fetchModels(command = executable(), version?: string) {
  const exec = promisify(execFile)
  const options = {
    env: childHarnessEnvironment(process.env),
    windowsHide: true,
    timeout: 12_000,
    maxBuffer: 256_000,
  }
  const { stdout } = await exec(command, ["models"], options).catch((cause) => {
    throw new Error("Antigravity could not list models. Check CLI sign-in and refresh the list.", {
      cause,
    })
  })
  const openModels = supportsOpenAntigravityModels(version)
  const models = stdout.split(/\r?\n/).flatMap((line) => {
    const [id, name] = line.trim().split("\t")
    return id && name && (openModels || id.startsWith("gemini-")) ? [{ id, name }] : []
  })
  if (!models.length) throw new Error("Antigravity returned no models. Check CLI sign-in.")
  return models
}

export async function antigravityIntegration() {
  if (!resolveAntigravityBinary()) return { state: "not_installed" as const }
  try {
    await fetchModels()
    return { state: "connected" as const }
  } catch (error) {
    const stderr = eventRecord(eventRecord(error).cause).stderr
    const needsLogin =
      typeof stderr === "string" &&
      /not (logged|signed) in|auth(?:entication)? required|please (log|sign) in/i.test(stderr)
    return { state: needsLogin ? ("not_logged_in" as const) : ("unknown" as const) }
  }
}

function configOptions(config: SessionConfigOption) {
  return config.options.flatMap((entry) => ("value" in entry ? [entry] : entry.options))
}

function modelConfig(config: SessionConfigOption[] | null | undefined) {
  return config?.find((option) => option.id === "model" || option.category === "model")
}

function thinkingConfig(config: SessionConfigOption[] | null | undefined) {
  return config?.find((option) => option.category === "thought_level")
}

function thinkingEfforts(config: SessionConfigOption) {
  return configOptions(config).flatMap(({ value, name }) =>
    (REASONING_EFFORTS as readonly string[]).includes(value)
      ? [{ value: value as ReasoningEffort, name }]
      : [],
  )
}

async function fetchCliModelCatalog(command: string) {
  const version = await promisify(execFile)(command, ["--version"], {
    env: childHarnessEnvironment(process.env),
    windowsHide: true,
    timeout: 5_000,
  }).then(
    ({ stdout }) => stdout.trim(),
    () => "",
  )
  return fetchModels(command, version)
}

async function fetchModelCatalog(command: string): Promise<AntigravityModelOption[]> {
  const directory = mkdtempSync(join(tmpdir(), "flapstack-agy-catalog-"))
  const child = spawn(command, ["acp"], {
    cwd: directory,
    env: childHarnessEnvironment(process.env),
    windowsHide: true,
    stdio: ["pipe", "pipe", "ignore"],
  })
  child.once("close", () => void rmdir(directory).catch(() => {}))
  const interruption = new Promise<never>((_, reject) => {
    child.once("error", reject)
    child.once("exit", () => reject(new Error("Antigravity closed during the catalog probe.")))
  })
  const connection = new ClientSideConnection(
    () => ({
      async sessionUpdate() {},
      async requestPermission() {
        return { outcome: { outcome: "cancelled" } }
      },
    }),
    ndJsonStream(
      Writable.toWeb(child.stdin),
      Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
    ),
  )
  const probe = async () => {
    const init = await connection.initialize({
      protocolVersion: 1,
      clientCapabilities: {},
      clientInfo: { name: "Flapstack", version: "1" },
    })
    if (init.protocolVersion !== 1) throw new Error("Incompatible Antigravity ACP version.")
    const session = await connection.newSession({ cwd: directory, mcpServers: [] })
    const model = modelConfig(session.configOptions)
    if (!model) throw new Error("Antigravity ACP did not expose its model configuration.")
    const advertised = configOptions(model).filter(
      ({ value }) =>
        supportsOpenAntigravityModels(init.agentInfo?.version) || value.startsWith("gemini-"),
    )
    if (!advertised.length) throw new Error("Antigravity ACP did not advertise any usable models.")
    const results: AntigravityModelOption[] = []
    for (const { value, name } of advertised) {
      const config =
        value === model.currentValue
          ? session.configOptions
          : (
              await connection.setSessionConfigOption({
                sessionId: session.sessionId,
                configId: model.id,
                value,
              })
            ).configOptions
      const thinking = thinkingConfig(config)
      results.push({
        id: value,
        name,
        ...(thinking
          ? {
              nativeEfforts: thinkingEfforts(thinking),
              defaultEffort: thinking.currentValue,
            }
          : {}),
      })
    }
    return results
  }
  try {
    return await bounded(Promise.race([probe(), interruption]), "catalog", 20_000)
  } finally {
    child.stdin.end()
    child.kill()
  }
}

type Dependencies = {
  registration?: (runId: string) => McpStdioRegistration | undefined
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

function activityStream() {
  const events = new PassThrough({ objectMode: true })
  // Setup may fail before attachment of the activity iterator.
  events.on("error", () => {})
  return events
}

function connect(context: RuntimeAdapterContext, deps: Dependencies) {
  const command = executable()
  const handshakeDirectory = mkdtempSync(join(tmpdir(), "flapstack-acp-"))
  const child = spawn(command, ["acp"], {
    cwd: handshakeDirectory,
    env: childHarnessEnvironment(process.env),
    windowsHide: true,
    stdio: ["pipe", "pipe", "ignore"],
  })
  child.once("close", () => void rmdir(handshakeDirectory).catch(() => {}))
  const state = {
    child,
    context,
    events: activityStream(),
    initialized: null as InitializeResponse | null,
    cwd: "",
    hadProjectMcp: false,
    productMcpName: null as string | null,
    sessionId: "",
    mapper: null as AntigravityEvents | null,
    prompt: "",
    collecting: false,
    completed: false,
  }
  function stop(error: Error) {
    state.events.destroy(error)
    child.kill()
  }
  child.once("error", stop)
  child.once("exit", (code, signal) => {
    if (!state.events.writableEnded && !state.events.destroyed)
      state.events.destroy(new Error(`Antigravity exited (${signal ?? code ?? "unknown"}).`))
  })
  const connection = new ClientSideConnection(
    () => ({
      async sessionUpdate({ sessionId, update }) {
        if (!state.collecting || state.sessionId !== sessionId || !state.mapper) return
        try {
          for (const event of state.mapper.update(update)) state.events.write(event)
        } catch (error) {
          stop(antigravityError("activity processing", error))
        }
      },
      async extMethod(method, params) {
        if (method !== "elicitation/create") throw RequestError.methodNotFound(method)
        if (params.sessionId !== state.sessionId || !state.collecting) return { action: "cancel" }
        return answerAntigravityForm(state.context, params, deps.ask)
      },
      async requestPermission(request: RequestPermissionRequest) {
        const cancelled = { outcome: { outcome: "cancelled" as const } }
        const context = state.context
        const isCurrent = () =>
          context === state.context &&
          !context.signal.aborted &&
          state.collecting &&
          request.sessionId === state.sessionId
        if (!isCurrent()) return cancelled
        const { toolCall, options } = request
        const allowOnce = options.find((option) => option.kind === "allow_once")
        if (!allowOnce) return cancelled
        let decision: "allow" | "ask" | "deny"
        try {
          const { mode } = context.launch.permission
          const scoped = mode === "auto-edit-project-only" || mode === "custom"
          const cwd =
            scoped && toolCall.kind && ["edit", "delete", "move"].includes(toolCall.kind)
              ? deps.cwd(context)
              : state.cwd
          if (cwd !== state.cwd) return cancelled
          decision = antigravityPermissionDecision(
            context.launch.permission,
            toolCall,
            cwd,
            state.productMcpName,
          )
        } catch {
          return cancelled
        }
        let userDeclined = decision === "deny"
        if (decision === "ask") {
          const input = eventRecord(toolCall.rawInput)
          const paths = toolCall.locations?.map(({ path }) => path)
          const result = eventRecord(
            await deps
              .permission(context.runId, {
                provider: "antigravity",
                toolName: toolCall.title || toolCall.kind || "Antigravity tool",
                toolInput: {
                  file_path: paths?.length ? paths.join("\n") : input.Path,
                  command: input.CommandLine ?? input.command ?? input.cmd,
                },
                params: { cwd: state.cwd },
              })
              .catch(() => null),
          )
          decision = result.decision === "accept" ? "allow" : "deny"
          userDeclined = result.userDeclined === true
        }
        if (!isCurrent()) return cancelled
        const selected =
          decision === "allow" ? allowOnce : options.find((option) => option.kind === "reject_once")
        state.mapper?.setFileChangeDeclined(toolCall, userDeclined)
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
  return { state, connection }
}

export function createAntigravityAdapter(deps: Dependencies): HarnessAdapter<AgentActivityAppend> {
  type Connection = ReturnType<typeof connect>
  const runs = new Map<string, Connection>()
  const idle = new Map<string, { run: Connection; timer: ReturnType<typeof setTimeout> }>()
  const projectApprovals = new Map<string, string>()
  let closing = false

  function close({ state }: Connection) {
    state.events.destroy()
    state.child.stdin.end()
    state.child.kill()
  }

  async function initialize(run: Connection) {
    if (run.state.initialized) return run.state.initialized
    // SDK 0.14.1 forwards draft ACP capabilities and requests through extMethod.
    const clientCapabilities: ClientCapabilities & { elicitation: { form: object } } = {
      elicitation: { form: {} },
    }
    const info = await bounded(
      run.connection.initialize({
        protocolVersion: 1,
        clientCapabilities,
        clientInfo: { name: "Flapstack", version: "1" },
      }),
      "initialization",
    )
    if (info.protocolVersion !== 1)
      throw new Error("Antigravity returned an incompatible ACP version.")
    run.state.initialized = info
    return info
  }

  async function open(
    context: RuntimeAdapterContext,
    previous?: RuntimeAdapterSession,
    useIdle = true,
  ): Promise<RuntimeAdapterSession> {
    if (context.outputSchema)
      throw new Error("Antigravity ACP does not support structured result schemas.")
    if (previous && !previous.providerSessionId)
      throw new Error("Cannot resume Antigravity without its saved session ID.")
    const key = context.subChatId ?? context.chatId
    const entry = useIdle ? idle.get(key) : undefined
    let warm = false
    let run: Connection | undefined
    if (entry) {
      idle.delete(key)
      clearTimeout(entry.timer)
      const { state } = entry.run
      if (
        previous?.providerSessionId === state.sessionId &&
        context.chatId === state.context.chatId &&
        state.child.exitCode == null &&
        state.child.signalCode == null
      ) {
        run = entry.run
        Object.assign(state, {
          context,
          events: activityStream(),
          prompt: "",
          mapper: null,
          completed: false,
          productMcpName: null,
        })
        warm = true
      } else close(entry.run)
    }
    run ??= connect(context, deps)
    runs.set(context.runId, run)
    const { state, connection } = run
    const init = await initialize(run)
    // Only the protocol handshake runs before the checkpoint. A session can load project hooks.
    await context.waitForWorkspace?.()
    context.signal.throwIfAborted()
    const cwd = deps.cwd(context)
    if (warm && cwd !== state.cwd) {
      close(run)
      return open(context, previous, false)
    }
    state.cwd = cwd
    const mode = context.launch.permission.mode
    const allowsProjectMcp = mode === "full-access" || mode === "ask-before-edits"
    if (warm && state.hadProjectMcp && !allowsProjectMcp) {
      // The provider may cache a previously authorized third-party process.
      close(run)
      return open(context, previous, false)
    }
    const mcpServers = allowsProjectMcp
      ? await projectMcpServers(
          cwd,
          init.agentCapabilities?.mcpCapabilities?.http === true,
          context,
          projectApprovals,
          deps.permission,
          (message) =>
            deps.append(context.runId, [
              {
                provider: "antigravity",
                kind: "warning",
                phase: "updated",
                displayClass: "status",
                privacyClass: "public",
                payload: { message, code: "gemini-project-mcp" },
              },
            ]),
        )
      : []
    state.hadProjectMcp = mcpServers.length > 0
    context.signal.throwIfAborted()
    const product = deps.registration?.(context.runId)
    if (product) {
      renameProductMcpServerCollisions(mcpServers)
      // ACP can load MCP servers from outside the launcher's registration list and
      // can identify a tool only by its flattened title. Use a fresh name for each run.
      const name = FLAPSTACK_MCP_SERVER_NAME + randomBytes(10).toString("hex")
      state.productMcpName = name
      mcpServers.push({
        name,
        command: product.command,
        args: product.args,
        env: Object.entries(product.env).map(([name, value]) => ({ name, value })),
      })
    }
    const session = previous?.providerSessionId
      ? await bounded(
          connection.unstable_resumeSession({
            sessionId: previous.providerSessionId,
            cwd,
            mcpServers,
          }),
          "resume",
        ).catch((error) => {
          if (!warm || context.signal.aborted) throw error
          return null
        })
      : await bounded(
          createAntigravitySession(
            () => connection.newSession({ cwd, mcpServers }),
            AbortSignal.any([context.signal, AbortSignal.timeout(ACP_REQUEST_TIMEOUT_MS)]),
          ),
          "session setup",
        )
    if (session === null) {
      // Some releases cannot reattach an already loaded session to refresh its run-bound MCP server.
      close(run)
      return open(context, previous, false)
    }
    const sessionId =
      previous?.providerSessionId || ("sessionId" in session && String(session.sessionId))
    if (!sessionId) throw new Error("Antigravity returned no session ID.")
    state.sessionId = sessionId
    state.mapper = new AntigravityEvents(sessionId, context.launch.controls.reasoningDisplay)
    const effort = context.launch.controls.modelEffort
    const model = modelConfig(session.configOptions)
    let selected = context.launch.model ?? (effort ? model?.currentValue : undefined)
    if (
      selected &&
      !selected.startsWith("gemini-") &&
      !supportsOpenAntigravityModels(init.agentInfo?.version)
    ) {
      throw new Error("This version of Antigravity only exposes Gemini models to Flapstack.")
    }
    if (model && selected && configOptions(model).some((option) => option.value === selected)) {
      let config = session.configOptions
      if (selected !== model.currentValue) {
        const selection = await bounded(
          connection.setSessionConfigOption({ sessionId, configId: model.id, value: selected }),
          "model selection",
        )
        config = selection.configOptions
      }
      const thinking = thinkingConfig(config)
      if (effort && thinking) {
        if (!thinkingEfforts(thinking).some(({ value }) => value === effort))
          throw new Error("Antigravity does not offer that reasoning effort for this model.")
        const verified = await bounded(
          connection.setSessionConfigOption({ sessionId, configId: thinking.id, value: effort }),
          "reasoning effort selection",
        )
        if (thinkingConfig(verified.configOptions)?.currentValue !== effort)
          throw new Error("Antigravity did not confirm the selected reasoning effort.")
      } else if (effort) {
        const options = await antigravityModels()
        const variants = antigravityEffortVariants(options, selected)
        const variant = variants.efforts.find((option) => option.label === effort)
        if (!variant)
          throw new Error("Antigravity does not offer that reasoning effort for this model.")
        if (variant.id !== selected) {
          selected = variant.id
          await bounded(
            connection.unstable_setSessionModel({ sessionId, modelId: selected }),
            "model selection",
          )
        }
      }
    } else if (selected || effort) {
      if (effort) {
        const options = await antigravityModels()
        const variant = antigravityEffortVariants(options, selected ?? options[0]?.id).efforts.find(
          (option) => option.label === effort,
        )
        if (!variant)
          throw new Error("Antigravity does not offer that reasoning effort for this model.")
        selected = variant.id
      }
      if (
        selected &&
        (selected.startsWith("gemini-") || supportsOpenAntigravityModels(init.agentInfo?.version))
      ) {
        await bounded(
          connection.unstable_setSessionModel({ sessionId, modelId: selected }),
          "model selection",
        )
      }
    }
    if (selected) {
      await deps.append(context.runId, [
        {
          provider: "flapstack",
          kind: "opaque-metadata",
          phase: "snapshot",
          displayClass: "metadata",
          privacyClass: "public",
          providerSessionId: sessionId,
          dedupKey: "agy-model-settings",
          payload: {
            eventType: "antigravity/set-session-model.settings-sent",
            metadata: { model: selected, effort },
          },
        },
      ])
    }
    await bounded(
      connection.setSessionMode({ sessionId, modeId: "default" }),
      "permission selection",
    )
    return { providerSessionId: sessionId, providerThreadId: null }
  }

  return {
    runtime: "flapstack-native",
    preparesSessionBeforeWorkspace: true,
    async probe(harness): Promise<RuntimeAdapterProbe> {
      let error: string | null = null
      let nativeThinking = false
      try {
        if (harness !== "antigravity") throw new Error("Wrong harness for Antigravity.")
        const models = await antigravityModels()
        nativeThinking = models.some((model) => Boolean(model.nativeEfforts?.length))
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
              supported: nativeThinking,
              reason: nativeThinking
                ? null
                : "This Antigravity catalog encodes effort in the model selection.",
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
            "Flapstack enforces Antigravity ACP tool requests. Workspace scopes do not authorize shell commands.",
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
          if (result.stopReason === "end_turn") {
            const compacted = state.mapper!.confirmedCompaction(state.prompt)
            if (compacted) state.events.write(compacted)
            else terminalError = state.mapper!.completionError()
          } else {
            terminalError = new Error(`Antigravity ended the turn: ${result.stopReason}.`)
          }
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
      if (!run) return
      runs.delete(context.runId)
      const { state } = run
      if (
        closing ||
        !state.completed ||
        context.signal.aborted ||
        state.child.exitCode != null ||
        state.child.signalCode != null
      ) {
        close(run)
        return
      }
      const sessionCapabilities = eventRecord(
        state.initialized?.agentCapabilities?.sessionCapabilities,
      )
      if (sessionCapabilities.close) {
        try {
          // Release run-bound MCP processes while keeping agy available for session/resume.
          await bounded(
            run.connection.extMethod("session/close", { sessionId: state.sessionId }),
            "release of the completed session",
            2_000,
          )
        } catch {
          close(run)
          return
        }
      }
      if (closing) {
        close(run)
        return
      }
      const key = context.subChatId ?? context.chatId
      const previous = idle.get(key)
      if (previous) {
        clearTimeout(previous.timer)
        close(previous.run)
      }
      const timer = setTimeout(() => {
        if (idle.get(key)?.run === run) idle.delete(key)
        close(run)
      }, 120_000)
      timer.unref()
      idle.set(key, { run, timer })
      if (idle.size > 4) {
        const oldest = idle.entries().next().value
        if (oldest) {
          const [chat, entry] = oldest
          idle.delete(chat)
          clearTimeout(entry.timer)
          close(entry.run)
        }
      }
    },
    closeIdleSessions() {
      closing = true
      for (const { run, timer } of idle.values()) {
        clearTimeout(timer)
        close(run)
      }
      idle.clear()
    },
  }
}
