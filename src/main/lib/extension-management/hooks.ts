import { spawn } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fstatSync,
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

const CLAUDE_HOOK_EVENTS = new Set([
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
const CODEX_HOOK_EVENTS = new Set([
  "PreToolUse",
  "PermissionRequest",
  "PostToolUse",
  "PreCompact",
  "PostCompact",
  "UserPromptSubmit",
  "SessionStart",
  "SubagentStart",
  "SubagentStop",
  "Stop",
])

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

export type ManagedHookCallback = (
  input: unknown,
  toolUseId: string | undefined,
  options: { signal: AbortSignal },
) => Promise<Record<string, unknown>>

export type ManagedClaudeHookOptions = Record<
  string,
  Array<{ matcher?: string; hooks: ManagedHookCallback[]; timeout: number }>
>

export type ManagedHookRuntimeExecutor = {
  execute(
    record: HookRecord,
    input: unknown,
    signal: AbortSignal,
    cwd?: string,
  ): Promise<Record<string, unknown>>
}

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
    let descriptor: number | null = null
    try {
      const pathInfo = lstatSync(this.path, { bigint: true })
      if (pathInfo.isSymbolicLink() || !pathInfo.isFile()) {
        throw new Error("Hook state must be a regular file")
      }
      descriptor = openSync(this.path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
      const openedInfo = fstatSync(descriptor, { bigint: true })
      if (
        !openedInfo.isFile() ||
        (pathInfo.dev !== 0n &&
          pathInfo.ino !== 0n &&
          (pathInfo.dev !== openedInfo.dev || pathInfo.ino !== openedInfo.ino))
      ) {
        throw new Error("Hook state identity changed while opening")
      }
      if (openedInfo.size > BigInt(MAX_HOOK_STATE_BYTES)) {
        throw new Error("Hook state exceeds the bounded file size")
      }
      return hookStateFileSchema.parse(JSON.parse(readFileSync(descriptor, "utf8"))).hooks
    } catch (error) {
      throw new Error("Hook state is unreadable; enablement is fail-closed", { cause: error })
    } finally {
      if (descriptor !== null) closeSync(descriptor)
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

export class NodeManagedHookRuntimeExecutor implements ManagedHookRuntimeExecutor {
  execute(
    record: HookRecord,
    input: unknown,
    signal: AbortSignal,
    cwd?: string,
  ): Promise<Record<string, unknown>> {
    assertHookRuntimeReady(record)
    const preview = parseHookCommand(record.definition.command)
    return new Promise((resolve, reject) => {
      let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0)
      let capturedBytes = 0
      let settled = false
      let timedOut = false
      let outputLimitExceeded = false
      const child = spawn(preview.executable, preview.args, {
        cwd: record.definition.cwd ?? cwd,
        shell: false,
        windowsHide: true,
        detached: process.platform !== "win32",
        stdio: ["pipe", "pipe", "pipe"],
        env: runtimeEnvironment(),
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
      const fail = (message: string): void => {
        if (settled) return
        settled = true
        cleanup()
        reject(new Error(message))
      }
      const abort = (): void => {
        stop()
        fail("Managed hook execution was cancelled")
      }
      const timer = setTimeout(
        () => {
          timedOut = true
          stop()
        },
        Math.max(1, Math.min(record.definition.timeoutMs, MAX_HOOK_DRY_RUN_MS)),
      )
      const cleanup = (): void => {
        clearTimeout(timer)
        signal.removeEventListener("abort", abort)
      }
      signal.addEventListener("abort", abort, { once: true })
      child.stdout?.on("data", (chunk: Buffer) => {
        const remaining = MAX_HOOK_OUTPUT_BYTES - capturedBytes
        if (remaining <= 0 || chunk.byteLength > remaining) {
          outputLimitExceeded = true
          stop()
          return
        }
        capturedBytes += chunk.byteLength
        stdout = Buffer.concat([stdout, chunk])
      })
      child.stderr?.on("data", (chunk: Buffer) => {
        capturedBytes += chunk.byteLength
        if (capturedBytes > MAX_HOOK_OUTPUT_BYTES) {
          outputLimitExceeded = true
          stop()
        }
      })
      child.once("error", () => fail("Managed hook could not be started"))
      child.once("close", (exitCode) => {
        if (settled) return
        if (timedOut) return fail("Managed hook timed out")
        if (outputLimitExceeded) return fail("Managed hook exceeded the output limit")
        if (exitCode !== 0) return fail("Managed hook exited unsuccessfully")
        settled = true
        cleanup()
        const output = stdout.toString("utf8").trim()
        if (!output) return resolve({})
        try {
          const parsed: unknown = JSON.parse(output)
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error("not an object")
          }
          resolve(parsed as Record<string, unknown>)
        } catch {
          reject(new Error("Managed hook returned invalid JSON"))
        }
      })
      if (signal.aborted) return abort()
      try {
        child.stdin?.end(JSON.stringify(input))
      } catch {
        stop()
        fail("Managed hook input could not be written")
      }
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
      if (current.definition.scope === "project") {
        this.resolveProjectCwd(current.definition.cwd!)
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
  const supportedEvents = input.harness === "claude-code" ? CLAUDE_HOOK_EVENTS : CODEX_HOOK_EVENTS
  if (!supportedEvents.has(input.event)) {
    issues.push({
      code: "event",
      path: "event",
      message: "Hook event is not supported by this harness",
    })
  }
  if (input.matcher) {
    try {
      new RegExp(input.matcher)
    } catch {
      issues.push({
        code: "event",
        path: "matcher",
        message: "Hook matcher must be a valid regular expression",
      })
    }
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

export function assertHookRuntimeReady(record: HookRecord): void {
  if (!record.validation?.valid || record.validation.revision !== record.revision) {
    throw new Error("Hook must pass validation before enablement")
  }
  if (!record.dryRun?.success || record.dryRun.revision !== record.revision) {
    throw new Error("Hook must pass the latest bounded dry-run before enablement")
  }
}

function assertEnableReady(record: HookRecord): void {
  assertHookRuntimeReady(record)
}

export function resolveEnabledManagedHooks(input: {
  store: HookStateStore
  harness: HookDraft["harness"]
  cwd: string
  resolveProjectCwd: (cwd: string) => string
}): HookRecord[] {
  const currentRoot = input.resolveProjectCwd(input.cwd)
  return input.store
    .read()
    .filter((record) => record.enabled && record.definition.harness === input.harness)
    .filter((record) => {
      assertHookRuntimeReady(record)
      const validation = validateHookDraft({ id: record.id, ...record.definition })
      if (!validation.valid || validation.revision !== record.revision) {
        throw new Error(`Enabled managed hook ${record.id} no longer validates`)
      }
      if (record.definition.scope === "user") return true
      if (record.definition.cwd !== currentRoot) return false
      const registeredRoot = input.resolveProjectCwd(record.definition.cwd)
      if (registeredRoot !== currentRoot) {
        throw new Error(`Managed hook ${record.id} project authority changed`)
      }
      return true
    })
}

export function buildManagedCodexHookConfig(records: HookRecord[]): Record<string, unknown> {
  const hooks: Record<string, Array<Record<string, unknown>>> = {}
  for (const record of records) {
    if (record.definition.harness !== "codex" || !CODEX_HOOK_EVENTS.has(record.definition.event)) {
      throw new Error(`Managed hook ${record.id} has no supported Codex runtime event`)
    }
    const groups = hooks[record.definition.event] ?? []
    groups.push({
      ...(record.definition.matcher ? { matcher: record.definition.matcher } : {}),
      hooks: [
        {
          type: "command",
          command: record.definition.command,
          timeout: Math.max(1, Math.ceil(record.definition.timeoutMs / 1_000)),
          statusMessage: `Flapstack hook: ${record.definition.name}`,
        },
      ],
    })
    hooks[record.definition.event] = groups
  }
  return records.length === 0 ? {} : { features: { hooks: true }, hooks }
}

export function buildManagedClaudeHookOptions(
  records: HookRecord[],
  execute: (
    record: HookRecord,
    input: unknown,
    signal: AbortSignal,
  ) => Promise<Record<string, unknown>>,
): ManagedClaudeHookOptions {
  const hooks: ManagedClaudeHookOptions = {}
  for (const record of records) {
    if (
      record.definition.harness !== "claude-code" ||
      !CLAUDE_HOOK_EVENTS.has(record.definition.event)
    ) {
      throw new Error(`Managed hook ${record.id} has no supported Claude runtime event`)
    }
    const groups = hooks[record.definition.event] ?? []
    groups.push({
      ...(record.definition.matcher ? { matcher: record.definition.matcher } : {}),
      timeout: Math.max(1, Math.ceil(record.definition.timeoutMs / 1_000)),
      hooks: [async (hookInput, _toolUseId, options) => execute(record, hookInput, options.signal)],
    })
    hooks[record.definition.event] = groups
  }
  return hooks
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

function runtimeEnvironment(): NodeJS.ProcessEnv {
  const allowed = ["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "SystemRoot", "WINDIR"]
  const env: NodeJS.ProcessEnv = { FLAPSTACK_MANAGED_HOOK: "1" }
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
