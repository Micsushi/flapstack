import { spawn } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { Mutex } from "async-mutex"
import { z } from "zod"

const require = createRequire(import.meta.url)

export const HOOK_MANAGEMENT_SCHEMA_VERSION = 1 as const
export const MAX_HOOK_DRY_RUN_MS = 10_000
export const MAX_HOOK_OUTPUT_BYTES = 64 * 1024
const MAX_MANAGED_HOOKS = 1_000
const MAX_HOOK_STATE_BYTES = 10 * 1024 * 1024

export const hookHarnessSchema = z.enum(["claude-code", "codex"])
export const hookScopeSchema = z.enum(["user", "project"])
export const hookLifecycleStateSchema = z.enum([
  "discovered",
  "validated",
  "dry-run-passed",
  "enabled",
  "disabled",
])

export const hookDraftSchema = z
  .object({
    id: z.string().uuid().optional(),
    name: z.string().trim().min(1).max(128),
    harness: hookHarnessSchema,
    scope: hookScopeSchema,
    cwd: z.string().trim().min(1).optional(),
    event: z.string().trim().min(1).max(64),
    matcher: z.string().max(512).optional(),
    command: z.string().min(1).max(8_192),
    timeoutMs: z.number().int().min(100).max(MAX_HOOK_DRY_RUN_MS).default(5_000),
  })
  .strict()

const hookCommandPreviewSchema = z
  .object({
    exactCommand: z.string(),
    executable: z.string(),
    args: z.array(z.string()),
    shell: z.literal(false),
    commandHash: z.string().length(64),
  })
  .strict()

const hookValidationIssueSchema = z
  .object({
    code: z.enum(["schema", "event", "scope", "command"]),
    path: z.string(),
    message: z.string(),
  })
  .strict()

export const hookValidationResultSchema = z
  .object({
    valid: z.boolean(),
    revision: z.string().length(64),
    issues: z.array(hookValidationIssueSchema),
    preview: hookCommandPreviewSchema.nullable(),
  })
  .strict()

const hookOutputSummarySchema = z
  .object({
    byteLength: z.number().int().nonnegative(),
    sha256: z.string().length(64),
    truncated: z.boolean(),
  })
  .strict()

export const hookDryRunResultSchema = z
  .object({
    revision: z.string().length(64),
    success: z.boolean(),
    exitCode: z.number().int().nullable(),
    signal: z.string().nullable(),
    timedOut: z.boolean(),
    outputLimitExceeded: z.boolean(),
    durationMs: z.number().int().nonnegative(),
    stdout: hookOutputSummarySchema,
    stderr: hookOutputSummarySchema,
    error: hookOutputSummarySchema.nullable(),
  })
  .strict()

export const hookRecordSchema = z
  .object({
    schemaVersion: z.literal(HOOK_MANAGEMENT_SCHEMA_VERSION),
    id: z.string().uuid(),
    definition: hookDraftSchema.omit({ id: true }),
    revision: z.string().length(64),
    state: hookLifecycleStateSchema,
    enabled: z.boolean(),
    imported: z.literal(true),
    validation: hookValidationResultSchema.nullable(),
    dryRun: hookDryRunResultSchema.nullable(),
    importedAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict()
  .superRefine((record, context) => {
    if (record.enabled !== (record.state === "enabled")) {
      context.addIssue({
        code: "custom",
        path: ["enabled"],
        message: "Enabled flag and lifecycle state disagree",
      })
    }
    if (
      ["validated", "dry-run-passed", "enabled"].includes(record.state) &&
      (!record.validation?.valid || record.validation.revision !== record.revision)
    ) {
      context.addIssue({
        code: "custom",
        path: ["validation"],
        message: "Lifecycle state requires validation for the current revision",
      })
    }
    if (
      ["dry-run-passed", "enabled"].includes(record.state) &&
      (!record.dryRun?.success || record.dryRun.revision !== record.revision)
    ) {
      context.addIssue({
        code: "custom",
        path: ["dryRun"],
        message: "Lifecycle state requires a successful dry-run for the current revision",
      })
    }
  })

const hookStateFileSchema = z
  .object({
    schemaVersion: z.literal(HOOK_MANAGEMENT_SCHEMA_VERSION),
    hooks: z.array(hookRecordSchema).max(MAX_MANAGED_HOOKS),
  })
  .strict()

export type HookDraft = z.infer<typeof hookDraftSchema>
export type HookRecord = z.infer<typeof hookRecordSchema>
export type HookValidationResult = z.infer<typeof hookValidationResultSchema>
export type HookDryRunResult = z.infer<typeof hookDryRunResultSchema>
export type HookCommandPreview = z.infer<typeof hookCommandPreviewSchema>

export type HookStateStore = {
  read(): HookRecord[]
  write(records: HookRecord[]): void
}

export type HookDryRunRequest = {
  preview: HookCommandPreview
  cwd: string | undefined
  timeoutMs: number
  maxOutputBytes: number
}

export type HookDryRunRunner = {
  run(request: HookDryRunRequest): Promise<Omit<HookDryRunResult, "revision">>
}

export type HookApprovalDecision = "approved" | "denied" | "timed-out" | "cancelled"

export type HookApprovalGate = {
  request(input: {
    action: "dry-run" | "enable"
    hookId: string
    harness: HookDraft["harness"]
    scope: HookDraft["scope"]
    event: string
    commandHash: string
  }): Promise<HookApprovalDecision>
}

export type HookAuditStatus =
  | "approval-required"
  | "allowed"
  | "denied"
  | "timed-out"
  | "dispatch-started"
  | "completed"
  | "failed"

export type HookAuditEvent = {
  action: "import" | "validate" | "dry-run" | "enable" | "disable"
  status: HookAuditStatus
  hookId: string
  harness: HookDraft["harness"]
  scope: HookDraft["scope"]
  eventHash: string
  commandHash: string
  state: HookRecord["state"]
  durationMs?: number
}

export type HookAuditWriter = { append(event: HookAuditEvent): void }

export class FileHookStateStore implements HookStateStore {
  constructor(private readonly path = defaultHookStatePath()) {}

  read(): HookRecord[] {
    if (!existsSync(this.path)) return []
    try {
      const info = lstatSync(this.path)
      if (info.isSymbolicLink() || !info.isFile()) {
        throw new Error("Hook state must be a regular file")
      }
      if (info.size > MAX_HOOK_STATE_BYTES) {
        throw new Error("Hook state exceeds the bounded file size")
      }
      return hookStateFileSchema.parse(JSON.parse(readFileSync(this.path, "utf8"))).hooks
    } catch (error) {
      throw new Error("Hook state is unreadable; enablement is fail-closed", { cause: error })
    }
  }

  write(records: HookRecord[]): void {
    const data = hookStateFileSchema.parse({
      schemaVersion: HOOK_MANAGEMENT_SCHEMA_VERSION,
      hooks: records,
    })
    if (existsSync(this.path)) {
      const info = lstatSync(this.path)
      if (info.isSymbolicLink() || !info.isFile()) {
        throw new Error("Hook state target must be a regular file")
      }
    }
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 })
    const temporary = `${this.path}.${randomUUID()}.tmp`
    let fd: number | null = null
    try {
      fd = openSync(temporary, "wx", 0o600)
      writeFileSync(fd, `${JSON.stringify(data, null, 2)}\n`, "utf8")
      fsyncSync(fd)
      closeSync(fd)
      fd = null
      renameSync(temporary, this.path)
      chmodSync(this.path, 0o600)
    } finally {
      if (fd !== null) closeSync(fd)
      rmSync(temporary, { force: true })
    }
  }
}

export class MemoryHookStateStore implements HookStateStore {
  private records: HookRecord[] = []

  read(): HookRecord[] {
    return structuredClone(this.records)
  }

  write(records: HookRecord[]): void {
    this.records = structuredClone(records)
  }
}

export class NodeHookDryRunRunner implements HookDryRunRunner {
  run(request: HookDryRunRequest): Promise<Omit<HookDryRunResult, "revision">> {
    const startedAt = Date.now()
    return new Promise((resolve) => {
      let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0)
      let stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0)
      let capturedBytes = 0
      let outputLimitExceeded = false
      let timedOut = false
      let spawnError: Error | null = null
      let settled = false
      const outputBudget = Math.max(0, Math.min(request.maxOutputBytes, MAX_HOOK_OUTPUT_BYTES))
      const child = spawn(request.preview.executable, request.preview.args, {
        cwd: request.cwd,
        shell: false,
        windowsHide: true,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
        env: dryRunEnvironment(),
      })

      const stop = (): void => {
        if (child.killed) return
        if (process.platform !== "win32" && child.pid) {
          try {
            process.kill(-child.pid, "SIGKILL")
            return
          } catch {
            // Fall back to the direct child if the process group already exited.
          }
        }
        child.kill("SIGKILL")
      }
      const append = (current: Buffer, chunk: Buffer): Buffer => {
        const remaining = outputBudget - capturedBytes
        if (remaining <= 0) {
          outputLimitExceeded = true
          stop()
          return current
        }
        if (chunk.byteLength > remaining) {
          outputLimitExceeded = true
          capturedBytes += remaining
          stop()
          return Buffer.concat([current, chunk.subarray(0, remaining)])
        }
        capturedBytes += chunk.byteLength
        return Buffer.concat([current, chunk])
      }
      child.stdout?.on("data", (chunk: Buffer) => {
        stdout = append(stdout, chunk)
      })
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr = append(stderr, chunk)
      })
      child.once("error", (error) => {
        spawnError = error
      })
      const timer = setTimeout(
        () => {
          timedOut = true
          stop()
        },
        Math.max(1, Math.min(request.timeoutMs, MAX_HOOK_DRY_RUN_MS)),
      )
      const finish = (exitCode: number | null, signal: NodeJS.Signals | null): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        const durationMs = Math.max(0, Date.now() - startedAt)
        resolve({
          success: exitCode === 0 && !timedOut && !outputLimitExceeded && spawnError === null,
          exitCode,
          signal,
          timedOut,
          outputLimitExceeded,
          durationMs,
          stdout: summarizeOutput(stdout, outputLimitExceeded),
          stderr: summarizeOutput(stderr, outputLimitExceeded),
          error: spawnError ? summarizeOutput(Buffer.from(spawnError.message), false) : null,
        })
      }
      child.once("close", finish)
      child.once("error", () => finish(null, null))
    })
  }
}

export class HookLifecycleService {
  private readonly mutex = new Mutex()

  constructor(
    private readonly store: HookStateStore,
    private readonly runner: HookDryRunRunner,
    private readonly approval?: HookApprovalGate,
    private readonly audit?: HookAuditWriter,
    private readonly resolveProjectCwd: (cwd: string) => string = (cwd) => cwd,
    private readonly onStateChange?: () => void,
  ) {}

  list(harness?: HookDraft["harness"]): HookRecord[] {
    return this.store.read().filter((record) => !harness || record.definition.harness === harness)
  }

  preview(input: HookDraft): HookValidationResult {
    return validateHookDraft(input)
  }

  import(inputValue: HookDraft): Promise<HookRecord> {
    return this.mutex.runExclusive(() => {
      const input = normalizeDraft(inputValue, this.resolveProjectCwd)
      const records = this.store.read()
      if (records.length >= MAX_MANAGED_HOOKS) throw new Error("Hook inventory limit reached")
      const id = inputValue.id ?? randomUUID()
      if (records.some((record) => record.id === id))
        throw new Error("Hook identity already exists")
      const now = new Date().toISOString()
      const { id: _ignoredId, ...definitionInput } = input
      const definition = hookDraftSchema.omit({ id: true }).parse(definitionInput)
      const record: HookRecord = {
        schemaVersion: HOOK_MANAGEMENT_SCHEMA_VERSION,
        id,
        definition,
        revision: hookRevision(definition),
        state: "discovered",
        enabled: false,
        imported: true,
        validation: null,
        dryRun: null,
        importedAt: now,
        updatedAt: now,
      }
      this.persist([...records, record])
      this.writeAudit("import", "completed", record)
      return record
    })
  }

  validate(id: string): Promise<HookRecord> {
    return this.mutex.runExclusive(() => {
      const records = this.store.read()
      const index = findRecord(records, id)
      const current = records[index]!
      if (current.enabled) {
        throw new Error("Enabled hooks must be disabled before validation")
      }
      const validation = validateHookDraft({ id, ...current.definition })
      const record: HookRecord = {
        ...current,
        state: validation.valid ? "validated" : "discovered",
        enabled: false,
        validation,
        dryRun: null,
        updatedAt: new Date().toISOString(),
      }
      records[index] = record
      this.persist(records)
      this.writeAudit("validate", validation.valid ? "completed" : "failed", record)
      return record
    })
  }

  async dryRun(id: string): Promise<HookRecord> {
    const candidate = await this.mutex.runExclusive(() => {
      const records = this.store.read()
      const index = findRecord(records, id)
      const current = records[index]!
      if (current.enabled) {
        throw new Error("Enabled hooks must be disabled before dry-run")
      }
      const validation = validateHookDraft({ id, ...current.definition })
      if (!validation.valid || !validation.preview) {
        const invalid: HookRecord = {
          ...current,
          state: "discovered",
          enabled: false,
          validation,
          dryRun: null,
          updatedAt: new Date().toISOString(),
        }
        records[index] = invalid
        this.persist(records)
        this.writeAudit("dry-run", "failed", invalid)
        return { record: invalid, ready: false as const }
      }
      const validated: HookRecord = {
        ...current,
        state: "validated",
        enabled: false,
        validation,
        dryRun: null,
        updatedAt: new Date().toISOString(),
      }
      records[index] = validated
      this.persist(records)
      this.writeAudit("dry-run", "approval-required", validated)
      return { record: validated, ready: true as const }
    })
    if (!candidate.ready) return candidate.record
    if (!this.approval) {
      this.writeAudit("dry-run", "failed", candidate.record)
      throw new Error("Hook approval gate is unavailable")
    }
    let decision: HookApprovalDecision
    try {
      decision = await this.approval.request({
        action: "dry-run",
        hookId: candidate.record.id,
        harness: candidate.record.definition.harness,
        scope: candidate.record.definition.scope,
        event: candidate.record.definition.event,
        commandHash: candidate.record.revision,
      })
    } catch (error) {
      this.writeAudit("dry-run", "failed", candidate.record)
      throw error
    }
    if (decision !== "approved") {
      this.writeAudit(
        "dry-run",
        decision === "timed-out" ? "timed-out" : "denied",
        candidate.record,
      )
      throw new Error(
        decision === "timed-out" ? "Hook dry-run approval timed out" : "Hook dry-run was denied",
      )
    }

    return this.mutex.runExclusive(async () => {
      const records = this.store.read()
      const index = findRecord(records, id)
      const current = records[index]!
      if (current.revision !== candidate.record.revision) {
        throw new Error("Hook changed while dry-run approval was pending")
      }
      const validation = validateHookDraft({ id, ...current.definition })
      if (!validation.valid || !validation.preview) {
        throw new Error("Hook validation changed while dry-run approval was pending")
      }
      const cwd =
        current.definition.scope === "project"
          ? this.resolveProjectCwd(current.definition.cwd!)
          : undefined
      this.writeAudit("dry-run", "allowed", current)
      this.writeAudit("dry-run", "dispatch-started", current)
      let outcome: Omit<HookDryRunResult, "revision">
      try {
        outcome = await this.runner.run({
          preview: validation.preview,
          cwd,
          timeoutMs: current.definition.timeoutMs,
          maxOutputBytes: MAX_HOOK_OUTPUT_BYTES,
        })
      } catch (error) {
        this.writeAudit("dry-run", "failed", current)
        throw error
      }
      const record: HookRecord = {
        ...current,
        state: outcome.success ? "dry-run-passed" : "validated",
        enabled: false,
        validation,
        dryRun: { revision: current.revision, ...outcome },
        updatedAt: new Date().toISOString(),
      }
      records[index] = record
      this.persist(records)
      this.writeAudit(
        "dry-run",
        outcome.success ? "completed" : "failed",
        record,
        outcome.durationMs,
      )
      return record
    })
  }

  async setEnabled(
    id: string,
    enabled: boolean,
  ): Promise<{ record: HookRecord; approval: HookApprovalDecision | "not-required" }> {
    if (!enabled) {
      return this.mutex.runExclusive(() => {
        const records = this.store.read()
        const index = findRecord(records, id)
        const record: HookRecord = {
          ...records[index]!,
          state: "disabled",
          enabled: false,
          updatedAt: new Date().toISOString(),
        }
        records[index] = record
        this.persist(records)
        this.writeAudit("disable", "completed", record)
        return { record, approval: "not-required" as const }
      })
    }

    const candidate = await this.mutex.runExclusive(() => {
      const record = readRecord(this.store, id)
      assertEnableReady(record)
      if (record.definition.scope === "project") {
        this.resolveProjectCwd(record.definition.cwd!)
      }
      this.writeAudit("enable", "approval-required", record)
      return record
    })
    if (!this.approval) {
      this.writeAudit("enable", "failed", candidate)
      throw new Error("Hook approval gate is unavailable")
    }
    let decision: HookApprovalDecision
    try {
      decision = await this.approval.request({
        action: "enable",
        hookId: candidate.id,
        harness: candidate.definition.harness,
        scope: candidate.definition.scope,
        event: candidate.definition.event,
        commandHash: candidate.revision,
      })
    } catch (error) {
      this.writeAudit("enable", "failed", candidate)
      throw error
    }
    if (decision !== "approved") {
      this.writeAudit("enable", decision === "timed-out" ? "timed-out" : "denied", candidate)
      return { record: candidate, approval: decision }
    }

    return this.mutex.runExclusive(() => {
      const records = this.store.read()
      const index = findRecord(records, id)
      const current = records[index]!
      if (current.revision !== candidate.revision) {
        throw new Error("Hook changed while approval was pending")
      }
      assertEnableReady(current)
      if (current.definition.scope === "project") {
        this.resolveProjectCwd(current.definition.cwd!)
      }
      const record: HookRecord = {
        ...current,
        state: "enabled",
        enabled: true,
        updatedAt: new Date().toISOString(),
      }
      this.writeAudit("enable", "allowed", record)
      records[index] = record
      this.persist(records)
      this.writeAudit("enable", "completed", record)
      return { record, approval: decision }
    })
  }

  private writeAudit(
    action: HookAuditEvent["action"],
    status: HookAuditStatus,
    record: HookRecord,
    durationMs?: number,
  ): void {
    this.audit?.append({
      action,
      status,
      hookId: record.id,
      harness: record.definition.harness,
      scope: record.definition.scope,
      eventHash: sha256(record.definition.event),
      commandHash: record.revision,
      state: record.state,
      ...(durationMs === undefined ? {} : { durationMs }),
    })
  }

  private persist(records: HookRecord[]): void {
    this.store.write(records)
    this.onStateChange?.()
  }
}

export function validateHookDraft(inputValue: HookDraft): HookValidationResult {
  const parsed = hookDraftSchema.safeParse(inputValue)
  if (!parsed.success) {
    return {
      valid: false,
      revision: hookRevision(stripHookId(inputValue)),
      issues: parsed.error.issues.map((issue) => ({
        code: "schema" as const,
        path: issue.path.join("."),
        message: issue.message,
      })),
      preview: null,
    }
  }
  const input = parsed.data
  const revision = hookRevision(stripHookId(input))
  const issues: z.infer<typeof hookValidationIssueSchema>[] = []
  const supportedEvents =
    input.harness === "claude-code"
      ? new Set([
          "PreToolUse",
          "PostToolUse",
          "PostToolUseFailure",
          "Notification",
          "UserPromptSubmit",
          "Stop",
          "SubagentStop",
          "PreCompact",
          "SessionStart",
          "SessionEnd",
        ])
      : new Set(["agent-turn-complete"])
  if (!supportedEvents.has(input.event)) {
    issues.push({
      code: "event",
      path: "event",
      message: "Hook event is not supported by this harness",
    })
  }
  if (input.harness === "codex" && input.matcher) {
    issues.push({
      code: "event",
      path: "matcher",
      message: "Codex notify hooks do not support matchers",
    })
  }
  if (input.scope === "project" && !input.cwd) {
    issues.push({
      code: "scope",
      path: "cwd",
      message: "Project hooks require a registered project root",
    })
  }
  let preview: HookCommandPreview | null = null
  try {
    preview = parseHookCommand(input.command)
  } catch (error) {
    issues.push({
      code: "command",
      path: "command",
      message: error instanceof Error ? error.message : String(error),
    })
  }
  return { valid: issues.length === 0, revision, issues, preview }
}

export function parseHookCommand(command: string): HookCommandPreview {
  if (!command.trim()) throw new Error("Hook command is empty")
  if (/[\0\r\n]/.test(command)) throw new Error("Hook command must be one line")
  if (/[|&;<>()`]/.test(command) || command.includes("$(") || command.includes("${")) {
    throw new Error("Shell operators and substitutions are not allowed")
  }
  const argv = tokenizeCommand(command)
  if (argv.length === 0) throw new Error("Hook command is empty")
  if (argv[0]!.startsWith("-") || /^[A-Za-z_][A-Za-z0-9_]*=/.test(argv[0]!)) {
    throw new Error("Hook command must start with an executable")
  }
  return {
    exactCommand: command,
    executable: argv[0]!,
    args: argv.slice(1),
    shell: false,
    commandHash: sha256(command),
  }
}

function tokenizeCommand(command: string): string[] {
  const tokens: string[] = []
  let token = ""
  let quote: "'" | '"' | null = null
  let escaped = false
  let started = false
  for (const character of command) {
    if (escaped) {
      token += character
      escaped = false
      started = true
      continue
    }
    if (character === "\\" && quote !== "'") {
      escaped = true
      started = true
      continue
    }
    if (quote) {
      if (character === quote) quote = null
      else token += character
      started = true
      continue
    }
    if (character === "'" || character === '"') {
      quote = character
      started = true
      continue
    }
    if (/\s/.test(character)) {
      if (started) {
        tokens.push(token)
        token = ""
        started = false
      }
      continue
    }
    token += character
    started = true
  }
  if (quote) throw new Error("Hook command contains an unterminated quote")
  if (escaped) throw new Error("Hook command contains a trailing escape")
  if (started) tokens.push(token)
  if (tokens.some((entry) => entry.includes("\0")))
    throw new Error("Hook command contains invalid characters")
  return tokens
}

function assertEnableReady(record: HookRecord): void {
  if (!record.validation?.valid || record.validation.revision !== record.revision) {
    throw new Error("Hook must pass validation before enablement")
  }
  if (!record.dryRun?.success || record.dryRun.revision !== record.revision) {
    throw new Error("Hook must pass the latest bounded dry-run before enablement")
  }
}

function normalizeDraft(
  inputValue: HookDraft,
  resolveProjectCwd: (cwd: string) => string,
): HookDraft {
  const input = hookDraftSchema.parse(inputValue)
  if (input.scope === "project") {
    if (!input.cwd) throw new Error("Project hooks require a registered project root")
    return { ...input, cwd: resolveProjectCwd(input.cwd) }
  }
  return { ...input, cwd: undefined }
}

function readRecord(store: HookStateStore, id: string): HookRecord {
  const records = store.read()
  return records[findRecord(records, id)]!
}

function findRecord(records: HookRecord[], id: string): number {
  const index = records.findIndex((record) => record.id === id)
  if (index < 0) throw new Error("Hook was not found")
  return index
}

function hookRevision(value: unknown): string {
  return sha256(canonicalJson(value))
}

function stripHookId(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value
  const { id: _ignoredId, ...definition } = value as Record<string, unknown>
  return definition
}

function canonicalJson(value: unknown): string {
  if (value === undefined) return "null"
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`
}

function summarizeOutput(buffer: Buffer, truncated: boolean) {
  return { byteLength: buffer.byteLength, sha256: sha256(buffer), truncated }
}

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex")
}

function dryRunEnvironment(): NodeJS.ProcessEnv {
  const allowed = ["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "SystemRoot", "WINDIR"]
  const env: NodeJS.ProcessEnv = { FLAPSTACK_HOOK_DRY_RUN: "1" }
  for (const key of allowed) if (process.env[key]) env[key] = process.env[key]
  return env
}

function defaultHookStatePath(): string {
  if (process.env.FLAPSTACK_CONFIG_DIR) {
    return join(process.env.FLAPSTACK_CONFIG_DIR, "hook-management.json")
  }
  try {
    const electron = require("electron") as { app?: { getPath(name: string): string } }
    const userData = electron.app?.getPath("userData")
    if (userData) return join(userData, "data", "hook-management.json")
  } catch {
    // Headless tests inject their own store.
  }
  return join(process.cwd(), ".flapstack", "data", "hook-management.json")
}
