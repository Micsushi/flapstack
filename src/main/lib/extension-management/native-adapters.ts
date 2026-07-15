import { createHash, randomUUID } from "node:crypto"
import { lstat, realpath, rename, rm } from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { Mutex } from "async-mutex"
import { createTwoFilesPatch } from "diff"
import matter from "gray-matter"
import { z } from "zod"
import {
  actOnPathInsideRoot,
  readFileInsideRoot,
  resolveInsideRoot,
  writeFileInsideRoot,
} from "../path-safety"
import {
  extensionCapabilityId,
  extensionCapabilityRegistry,
  extensionHarnesses,
  extensionKinds,
  extensionScopes,
  type ExtensionCapability,
  type ExtensionHarness,
  type ExtensionKind,
  type ExtensionScope,
} from "./capability-registry"

export const NATIVE_EXTENSION_ADAPTER_SCHEMA_VERSION = 1 as const

const MAX_NATIVE_FILE_BYTES = 1_000_000
const MAX_BACKUP_FILE_BYTES = 2_000_000
const BACKUP_DIRECTORY = ".flapstack-backups"

const mutationLocks = new Map<string, Mutex>()

const metadataRecordSchema = z.record(z.string(), z.unknown())

export const nativeExtensionTargetSchema = z.object({
  harness: z.enum(extensionHarnesses),
  kind: z.enum(extensionKinds),
  scope: z.enum(extensionScopes),
  name: z.string().min(1).max(64),
  cwd: z.string().optional(),
})

export const nativeExtensionMutationSchema = z.object({
  operation: z.enum(["create", "update", "delete"]),
  target: nativeExtensionTargetSchema,
  changes: z
    .object({
      content: z.string().max(MAX_NATIVE_FILE_BYTES).optional(),
      metadata: metadataRecordSchema.optional(),
      removeMetadata: z.array(z.string().min(1).max(128)).max(128).optional(),
    })
    .optional(),
})

export const nativeExtensionApplySchema = nativeExtensionMutationSchema.extend({
  expectedHash: z.string().length(64).nullable(),
  confirmationHash: z.string().length(64),
})

export const nativeExtensionRestoreSchema = z.object({
  target: nativeExtensionTargetSchema,
  backupId: z.string().uuid(),
})

export type NativeExtensionTarget = z.infer<typeof nativeExtensionTargetSchema>
export type NativeExtensionMutation = z.infer<typeof nativeExtensionMutationSchema>
export type NativeExtensionApply = z.infer<typeof nativeExtensionApplySchema>
export type NativeExtensionRestore = z.infer<typeof nativeExtensionRestoreSchema>

export type NativeExtensionDocument = {
  schemaVersion: typeof NATIVE_EXTENSION_ADAPTER_SCHEMA_VERSION
  target: NativeExtensionTarget
  path: string
  raw: string
  hash: string
  content: string
  metadata: Record<string, unknown>
  unknownFields: string[]
}

export type NativeExtensionMutationPreview = {
  schemaVersion: typeof NATIVE_EXTENSION_ADAPTER_SCHEMA_VERSION
  operation: NativeExtensionMutation["operation"]
  target: NativeExtensionTarget
  path: string
  capabilityId: string
  beforeHash: string | null
  afterHash: string | null
  confirmationHash: string
  unknownFields: string[]
  changed: boolean
  diff: string
}

export type NativeExtensionBackupReference = {
  schemaVersion: typeof NATIVE_EXTENSION_ADAPTER_SCHEMA_VERSION
  backupId: string
  relativePath: string
  beforeHash: string | null
  afterHash: string | null
  createdAt: number
}

export type NativeExtensionMutationResult = NativeExtensionMutationPreview & {
  backup: NativeExtensionBackupReference | null
  runtimeConsumption: ExtensionCapability["runtimeConsumption"]
}

export type NativeExtensionAdapterRegistration = {
  capabilityId: string
  harness: ExtensionHarness
  kind: Extract<ExtensionKind, "skill" | "command" | "custom-agent">
  scope: Extract<ExtensionScope, "user" | "project">
  format: "markdown-frontmatter"
}

export type NativeExtensionAdapterDescriptor = NativeExtensionAdapterRegistration & {
  shape: AdapterShape
  knownFields: string[]
}

export type NativeExtensionMetadataValidation =
  { valid: true; metadata: Record<string, unknown> } | { valid: false; reason: string }

type AdapterShape = "skill-directory" | "markdown-file"

type NativeAdapterDefinition = {
  harness: ExtensionHarness
  kind: Extract<ExtensionKind, "skill" | "command" | "custom-agent">
  scopes: Array<Extract<ExtensionScope, "user" | "project">>
  userRoot?: string[]
  projectRoot: string[]
  shape: AdapterShape
  knownFields: string[]
  metadataSchema: z.ZodType<Record<string, unknown>>
}

type ResolvedNativeTarget = {
  target: NativeExtensionTarget
  capability: ExtensionCapability
  adapter: NativeAdapterDefinition
  boundaryRoot: string
  extensionRootRelative: string
  targetRelative: string
  targetPath: string
}

type RawState = { raw: string; hash: string } | null

const nonEmptyString = z.string().trim().min(1)
const optionalString = z.string().optional()
const stringOrStringArray = z.union([z.string(), z.array(z.string())]).optional()

const claudeSkillKnownFields = [
  "name",
  "description",
  "when_to_use",
  "argument-hint",
  "arguments",
  "disable-model-invocation",
  "user-invocable",
  "allowed-tools",
  "disallowed-tools",
  "model",
  "effort",
  "context",
  "agent",
  "hooks",
  "paths",
  "shell",
] as const

const claudeSkillMetadataSchema = z
  .object({
    name: optionalString,
    description: optionalString,
    when_to_use: optionalString,
    "argument-hint": optionalString,
    arguments: stringOrStringArray,
    "disable-model-invocation": z.boolean().optional(),
    "user-invocable": z.boolean().optional(),
    "allowed-tools": stringOrStringArray,
    "disallowed-tools": stringOrStringArray,
    model: optionalString,
    effort: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
    context: z.literal("fork").optional(),
    agent: optionalString,
    hooks: z.unknown().optional(),
    paths: stringOrStringArray,
    shell: z.enum(["bash", "powershell"]).optional(),
  })
  .passthrough()

const agentSkillKnownFields = [
  "name",
  "description",
  "license",
  "compatibility",
  "metadata",
  "allowed-tools",
] as const

const agentSkillMetadataSchema = z
  .object({
    name: nonEmptyString,
    description: nonEmptyString,
    license: optionalString,
    compatibility: optionalString,
    metadata: metadataRecordSchema.optional(),
    "allowed-tools": stringOrStringArray,
  })
  .passthrough()

const commandMetadataSchema = z
  .object({
    description: optionalString,
    "argument-hint": optionalString,
    "allowed-tools": stringOrStringArray,
    model: optionalString,
    "disable-model-invocation": z.boolean().optional(),
  })
  .passthrough()

const agentMetadataSchema = z
  .object({
    name: nonEmptyString,
    description: nonEmptyString,
    model: optionalString,
    tools: stringOrStringArray,
    disallowedTools: stringOrStringArray,
    permissionMode: z
      .enum(["default", "acceptEdits", "auto", "dontAsk", "bypassPermissions", "plan"])
      .optional(),
    maxTurns: z.number().int().positive().optional(),
    skills: stringOrStringArray,
    mcpServers: z.unknown().optional(),
    hooks: z.unknown().optional(),
    memory: z.enum(["user", "project", "local"]).optional(),
    background: z.boolean().optional(),
    effort: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
    isolation: z.literal("worktree").optional(),
    color: z
      .enum(["red", "blue", "green", "yellow", "purple", "orange", "pink", "cyan"])
      .optional(),
    initialPrompt: optionalString,
  })
  .passthrough()

const cursorCommandMetadataSchema = z
  .object({
    description: optionalString,
  })
  .passthrough()

const nativeAdapters: NativeAdapterDefinition[] = [
  adapter(
    "claude-code",
    "skill",
    ["user", "project"],
    [".claude", "skills"],
    "skill-directory",
    [...claudeSkillKnownFields],
    claudeSkillMetadataSchema,
  ),
  adapter(
    "claude-code",
    "command",
    ["user", "project"],
    [".claude", "commands"],
    "markdown-file",
    [...claudeSkillKnownFields],
    claudeSkillMetadataSchema,
  ),
  adapter(
    "claude-code",
    "custom-agent",
    ["user", "project"],
    [".claude", "agents"],
    "markdown-file",
    [
      "name",
      "description",
      "tools",
      "disallowedTools",
      "model",
      "permissionMode",
      "maxTurns",
      "skills",
      "mcpServers",
      "hooks",
      "memory",
      "background",
      "effort",
      "isolation",
      "color",
      "initialPrompt",
    ],
    agentMetadataSchema,
  ),
  adapter(
    "codex",
    "skill",
    ["user", "project"],
    [".agents", "skills"],
    "skill-directory",
    [...agentSkillKnownFields],
    agentSkillMetadataSchema,
  ),
  adapter(
    "codex",
    "command",
    ["user", "project"],
    [".codex", "commands"],
    "markdown-file",
    ["description", "argument-hint", "allowed-tools", "model", "disable-model-invocation"],
    commandMetadataSchema,
  ),
  {
    ...adapter(
      "cursor-agent",
      "command",
      ["project"],
      [".cursor", "commands"],
      "markdown-file",
      ["description"],
      cursorCommandMetadataSchema,
    ),
    userRoot: undefined,
  },
]

export const nativeExtensionAdapterRegistry: NativeExtensionAdapterRegistration[] =
  nativeAdapters.flatMap((entry) =>
    entry.scopes.map((scope) => ({
      capabilityId: extensionCapabilityId(entry.harness, entry.kind, scope),
      harness: entry.harness,
      kind: entry.kind,
      scope,
      format: "markdown-frontmatter" as const,
    })),
  )

export function getNativeExtensionAdapterDescriptor(
  targetInput: NativeExtensionTarget,
): NativeExtensionAdapterDescriptor {
  const target = nativeExtensionTargetSchema.parse(targetInput)
  const adapterDefinition = findAdapter(target)
  return {
    capabilityId: extensionCapabilityId(target.harness, target.kind, target.scope),
    harness: adapterDefinition.harness,
    kind: adapterDefinition.kind,
    scope: target.scope as "user" | "project",
    format: "markdown-frontmatter",
    shape: adapterDefinition.shape,
    knownFields: [...adapterDefinition.knownFields],
  }
}

const backupRecordSchema = z
  .object({
    schemaVersion: z.literal(NATIVE_EXTENSION_ADAPTER_SCHEMA_VERSION),
    backupId: z.string().uuid(),
    createdAt: z.number().int().nonnegative(),
    target: nativeExtensionTargetSchema,
    targetRelative: z.string().min(1),
    beforeHash: z.string().length(64).nullable(),
    afterHash: z.string().length(64).nullable(),
    beforeContentBase64: z.string().nullable(),
  })
  .strict()

type BackupRecord = z.infer<typeof backupRecordSchema>

export function parseNativeExtensionContent(
  targetInput: NativeExtensionTarget,
  raw: string,
): NativeExtensionDocument {
  const target = nativeExtensionTargetSchema.parse(targetInput)
  const adapterDefinition = findAdapter(target)
  const parsed = parseMatter(raw)
  const validation = validateMetadata(adapterDefinition, parsed.data)
  if (!validation.valid) throw new Error(validation.reason)
  const metadata = validation.metadata
  const unknownFields = Object.keys(metadata)
    .filter((key) => !adapterDefinition.knownFields.includes(key))
    .sort()
  return {
    schemaVersion: NATIVE_EXTENSION_ADAPTER_SCHEMA_VERSION,
    target,
    path: nativePathTemplate(adapterDefinition, target),
    raw,
    hash: sha256(raw),
    content: parsed.content,
    metadata,
    unknownFields,
  }
}

export function validateNativeExtensionMetadata(
  targetInput: NativeExtensionTarget,
  metadata: Record<string, unknown>,
): NativeExtensionMetadataValidation {
  return validateMetadata(findAdapter(nativeExtensionTargetSchema.parse(targetInput)), metadata)
}

export function serializeNativeExtensionDocument(document: NativeExtensionDocument): string {
  parseNativeExtensionContent(document.target, document.raw)
  return document.raw
}

export async function readNativeExtension(
  targetInput: NativeExtensionTarget,
  options: { homeDir?: string } = {},
): Promise<NativeExtensionDocument> {
  const resolved = resolveNativeTarget(targetInput, options)
  const raw = await readRawState(resolved)
  if (!raw) throw new Error("Native extension file does not exist")
  return {
    ...parseNativeExtensionContent(resolved.target, raw.raw),
    path: resolved.targetPath,
  }
}

export async function previewNativeExtensionMutation(
  inputValue: NativeExtensionMutation,
  options: { homeDir?: string } = {},
): Promise<NativeExtensionMutationPreview> {
  const input = nativeExtensionMutationSchema.parse(inputValue)
  const resolved = resolveNativeTarget(input.target, options, input.operation)
  await assertSafeProspectivePath(resolved.boundaryRoot, resolved.targetRelative)
  const before = await readRawState(resolved)
  const next = buildNextState(resolved, input, before)
  return createPreview(resolved, input.operation, before, next)
}

export async function applyNativeExtensionMutation(
  inputValue: NativeExtensionApply,
  options: {
    homeDir?: string
    beforeCommit?: (targetPath: string) => void | Promise<void>
    afterCommit?: (targetPath: string) => void | Promise<void>
  } = {},
): Promise<NativeExtensionMutationResult> {
  const input = nativeExtensionApplySchema.parse(inputValue)
  const resolved = resolveNativeTarget(input.target, options, input.operation)
  return targetLock(resolved.targetPath).runExclusive(async () => {
    await assertSafeProspectivePath(resolved.boundaryRoot, resolved.targetRelative)
    const before = await readRawState(resolved)
    if ((before?.hash ?? null) !== input.expectedHash) {
      throw new Error("Native extension changed after preview")
    }
    const next = buildNextState(resolved, input, before)
    const preview = createPreview(resolved, input.operation, before, next)
    if (preview.confirmationHash !== input.confirmationHash) {
      throw new Error("Native extension preview confirmation is stale or invalid")
    }
    if (!preview.changed) {
      return {
        ...preview,
        backup: null,
        runtimeConsumption: resolved.capability.runtimeConsumption,
      }
    }

    const backup = await writeBackup(resolved, before, next)
    let committed = false
    try {
      await commitRawState(resolved, before, next, options.beforeCommit)
      committed = true
      await options.afterCommit?.(resolved.targetPath)
      const committedState = await readRawState(resolved)
      if ((committedState?.hash ?? null) !== (next?.hash ?? null)) {
        throw new Error("Native extension commit verification failed")
      }
      return {
        ...preview,
        backup,
        runtimeConsumption: resolved.capability.runtimeConsumption,
      }
    } catch (error) {
      if (committed) {
        try {
          await restoreRawState(resolved, next, before)
        } catch (rollbackError) {
          throw new AggregateError(
            [error, rollbackError],
            "Native extension mutation failed and rollback could not be completed",
          )
        }
      }
      throw error
    }
  })
}

export async function restoreNativeExtensionBackup(
  inputValue: NativeExtensionRestore,
  options: {
    homeDir?: string
    beforeCommit?: (targetPath: string) => void | Promise<void>
    afterCommit?: (targetPath: string) => void | Promise<void>
  } = {},
): Promise<{ backup: NativeExtensionBackupReference; restoredHash: string | null }> {
  const input = nativeExtensionRestoreSchema.parse(inputValue)
  const resolved = resolveNativeTarget(input.target, options)
  return targetLock(resolved.targetPath).runExclusive(async () => {
    const record = await readBackup(resolved, input.backupId)
    const current = await readRawState(resolved)
    if ((current?.hash ?? null) !== record.afterHash) {
      throw new Error("Native extension changed after backup; refusing stale restore")
    }
    const before = rawStateFromBackup(record)
    let committed = false
    try {
      await commitRawState(resolved, current, before, options.beforeCommit)
      committed = true
      await options.afterCommit?.(resolved.targetPath)
      const restored = await readRawState(resolved)
      if ((restored?.hash ?? null) !== record.beforeHash) {
        throw new Error("Native extension restore verification failed")
      }
      return {
        backup: backupReference(record, backupRelativePath(resolved, input.backupId)),
        restoredHash: restored?.hash ?? null,
      }
    } catch (error) {
      if (committed) {
        try {
          await restoreRawState(resolved, before, current)
        } catch (rollbackError) {
          throw new AggregateError(
            [error, rollbackError],
            "Native extension restore failed and rollback could not be completed",
          )
        }
      }
      throw error
    }
  })
}

function adapter(
  harness: NativeAdapterDefinition["harness"],
  kind: NativeAdapterDefinition["kind"],
  scopes: NativeAdapterDefinition["scopes"],
  root: string[],
  shape: AdapterShape,
  knownFields: string[],
  metadataSchema: z.ZodType<Record<string, unknown>>,
): NativeAdapterDefinition {
  return {
    harness,
    kind,
    scopes,
    userRoot: root,
    projectRoot: root,
    shape,
    knownFields,
    metadataSchema,
  }
}

function validateMetadata(
  adapterDefinition: NativeAdapterDefinition,
  metadata: Record<string, unknown>,
): NativeExtensionMetadataValidation {
  try {
    return { valid: true, metadata: adapterDefinition.metadataSchema.parse(metadata) }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { valid: false, reason: `Native extension metadata schema is invalid: ${message}` }
  }
}

function findAdapter(target: NativeExtensionTarget): NativeAdapterDefinition {
  const found = nativeAdapters.find(
    (candidate) =>
      candidate.harness === target.harness &&
      candidate.kind === target.kind &&
      candidate.scopes.includes(target.scope as "user" | "project"),
  )
  if (!found) {
    throw new Error(
      `No native file adapter is registered for ${target.harness}:${target.kind}:${target.scope}`,
    )
  }
  return found
}

function resolveNativeTarget(
  targetInput: NativeExtensionTarget,
  options: { homeDir?: string },
  operation?: NativeExtensionMutation["operation"],
): ResolvedNativeTarget {
  const target = nativeExtensionTargetSchema.parse(targetInput)
  validateName(target.name)
  const capability = extensionCapabilityRegistry.find(
    (candidate) =>
      candidate.id === extensionCapabilityId(target.harness, target.kind, target.scope),
  )
  if (!capability) throw new Error("Native extension capability is not registered")
  if (operation && !capability.mutations.includes(operation)) {
    throw new Error(`${operation} is not supported by ${capability.id}`)
  }
  const adapterDefinition = findAdapter(target)
  if (target.scope === "plugin") throw new Error("Plugin-owned extensions are read-only")
  const boundaryRoot = path.resolve(
    target.scope === "user" ? (options.homeDir ?? os.homedir()) : requireProjectRoot(target),
  )
  const rootParts =
    target.scope === "user" ? adapterDefinition.userRoot : adapterDefinition.projectRoot
  if (!rootParts) throw new Error(`No ${target.scope} root exists for ${capability.id}`)
  const extensionRootRelative = path.join(...rootParts)
  const targetRelative =
    adapterDefinition.shape === "skill-directory"
      ? path.join(extensionRootRelative, target.name, "SKILL.md")
      : path.join(extensionRootRelative, `${target.name}.md`)
  const targetPath = resolveInsideRoot(boundaryRoot, targetRelative)
  return {
    target: { ...target, cwd: target.scope === "project" ? boundaryRoot : undefined },
    capability,
    adapter: adapterDefinition,
    boundaryRoot,
    extensionRootRelative,
    targetRelative,
    targetPath,
  }
}

function requireProjectRoot(target: NativeExtensionTarget): string {
  if (!target.cwd) throw new Error("Project-scoped native extensions require a registered project")
  if (!path.isAbsolute(target.cwd)) throw new Error("Project root must be absolute")
  return target.cwd
}

function buildNextState(
  resolved: ResolvedNativeTarget,
  input: NativeExtensionMutation,
  before: RawState,
): RawState {
  if (input.operation === "create" && before) throw new Error("Native extension already exists")
  if (input.operation !== "create" && !before)
    throw new Error("Native extension file does not exist")
  if (input.operation === "delete") {
    parseNativeExtensionContent(resolved.target, before!.raw)
    return null
  }

  const existing = before
    ? parseNativeExtensionContent(resolved.target, before.raw)
    : {
        content: "",
        metadata: {} as Record<string, unknown>,
      }
  const metadata = { ...existing.metadata, ...(input.changes?.metadata ?? {}) }
  for (const key of input.changes?.removeMetadata ?? []) delete metadata[key]
  const content = input.changes?.content ?? existing.content
  const raw =
    before &&
    input.changes?.content === undefined &&
    input.changes?.metadata === undefined &&
    input.changes?.removeMetadata === undefined
      ? before.raw
      : serializeMatter(content, metadata)
  if (Buffer.byteLength(raw) > MAX_NATIVE_FILE_BYTES) {
    throw new Error("Native extension file exceeds the allowed size")
  }
  parseNativeExtensionContent(resolved.target, raw)
  return { raw, hash: sha256(raw) }
}

function createPreview(
  resolved: ResolvedNativeTarget,
  operation: NativeExtensionMutation["operation"],
  before: RawState,
  next: RawState,
): NativeExtensionMutationPreview {
  const nextDocument = next ? parseNativeExtensionContent(resolved.target, next.raw) : null
  const preview = {
    schemaVersion: NATIVE_EXTENSION_ADAPTER_SCHEMA_VERSION,
    operation,
    target: resolved.target,
    path: resolved.targetPath,
    capabilityId: resolved.capability.id,
    beforeHash: before?.hash ?? null,
    afterHash: next?.hash ?? null,
    unknownFields: nextDocument?.unknownFields ?? [],
    changed: (before?.hash ?? null) !== (next?.hash ?? null),
    diff: createTwoFilesPatch(
      resolved.targetPath,
      resolved.targetPath,
      before?.raw ?? "",
      next?.raw ?? "",
      before ? "native" : "missing",
      next ? "preview" : "deleted",
      { context: 3 },
    ),
  }
  return { ...preview, confirmationHash: sha256(JSON.stringify(preview)) }
}

async function readRawState(resolved: ResolvedNativeTarget): Promise<RawState> {
  try {
    const raw = (
      await readFileInsideRoot(resolved.boundaryRoot, resolved.targetRelative, {
        maxBytes: MAX_NATIVE_FILE_BYTES,
      })
    ).toString("utf8")
    return { raw, hash: sha256(raw) }
  } catch (error) {
    if (isMissing(error)) return null
    throw error
  }
}

async function commitRawState(
  resolved: ResolvedNativeTarget,
  current: RawState,
  next: RawState,
  beforeCommit?: (targetPath: string) => void | Promise<void>,
): Promise<void> {
  const guardedCommit = async (targetPath: string) => {
    await assertCurrentState(resolved, current)
    await beforeCommit?.(targetPath)
    await assertCurrentState(resolved, current)
  }
  if (next) {
    await writeFileInsideRoot(
      resolved.boundaryRoot,
      resolved.targetRelative,
      { data: next.raw },
      { overwrite: Boolean(current), beforeCommit: guardedCommit },
    )
    return
  }
  if (!current) return
  await actOnPathInsideRoot(resolved.boundaryRoot, resolved.targetRelative, atomicDeleteFile, {
    beforeCommit: guardedCommit,
  })
}

async function assertCurrentState(
  resolved: ResolvedNativeTarget,
  expected: RawState,
): Promise<void> {
  const current = await readRawState(resolved)
  if ((current?.hash ?? null) !== (expected?.hash ?? null)) {
    throw new Error("Native extension changed during commit")
  }
}

async function restoreRawState(
  resolved: ResolvedNativeTarget,
  expectedCurrent: RawState,
  wanted: RawState,
): Promise<void> {
  const current = await readRawState(resolved)
  if ((current?.hash ?? null) !== (expectedCurrent?.hash ?? null)) {
    throw new Error("Native extension changed during rollback")
  }
  await commitRawState(resolved, current, wanted)
  const restored = await readRawState(resolved)
  if ((restored?.hash ?? null) !== (wanted?.hash ?? null)) {
    throw new Error("Native extension rollback verification failed")
  }
}

async function writeBackup(
  resolved: ResolvedNativeTarget,
  before: RawState,
  next: RawState,
): Promise<NativeExtensionBackupReference> {
  const backupId = randomUUID()
  const createdAt = Date.now()
  const relativePath = backupRelativePath(resolved, backupId)
  const record: BackupRecord = {
    schemaVersion: NATIVE_EXTENSION_ADAPTER_SCHEMA_VERSION,
    backupId,
    createdAt,
    target: resolved.target,
    targetRelative: resolved.targetRelative,
    beforeHash: before?.hash ?? null,
    afterHash: next?.hash ?? null,
    beforeContentBase64: before ? Buffer.from(before.raw, "utf8").toString("base64") : null,
  }
  await writeFileInsideRoot(resolved.boundaryRoot, relativePath, {
    data: `${JSON.stringify(record)}\n`,
  })
  return backupReference(record, relativePath)
}

async function readBackup(resolved: ResolvedNativeTarget, backupId: string): Promise<BackupRecord> {
  const relativePath = backupRelativePath(resolved, backupId)
  const raw = (
    await readFileInsideRoot(resolved.boundaryRoot, relativePath, {
      maxBytes: MAX_BACKUP_FILE_BYTES,
    })
  ).toString("utf8")
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new Error("Native extension backup is malformed")
  }
  const record = backupRecordSchema.parse(value)
  if (
    record.backupId !== backupId ||
    record.targetRelative !== resolved.targetRelative ||
    JSON.stringify(record.target) !== JSON.stringify(resolved.target)
  ) {
    throw new Error("Native extension backup does not match the requested target")
  }
  const before = rawStateFromBackup(record)
  if ((before?.hash ?? null) !== record.beforeHash) {
    throw new Error("Native extension backup checksum does not match its content")
  }
  return record
}

function rawStateFromBackup(record: BackupRecord): RawState {
  if (record.beforeContentBase64 === null) return null
  const raw = Buffer.from(record.beforeContentBase64, "base64").toString("utf8")
  return { raw, hash: sha256(raw) }
}

function backupReference(
  record: BackupRecord,
  relativePath: string,
): NativeExtensionBackupReference {
  return {
    schemaVersion: record.schemaVersion,
    backupId: record.backupId,
    relativePath,
    beforeHash: record.beforeHash,
    afterHash: record.afterHash,
    createdAt: record.createdAt,
  }
}

function backupRelativePath(resolved: ResolvedNativeTarget, backupId: string): string {
  if (!z.string().uuid().safeParse(backupId).success) throw new Error("Backup identity is invalid")
  const targetKey = sha256(resolved.targetRelative).slice(0, 24)
  return path.join(resolved.extensionRootRelative, BACKUP_DIRECTORY, targetKey, `${backupId}.json`)
}

async function atomicDeleteFile(file: string): Promise<void> {
  const staged = `${file}.flapstack-${randomUUID()}.delete`
  await rename(file, staged)
  try {
    await rm(staged)
  } catch (error) {
    await rename(staged, file).catch(() => undefined)
    throw error
  }
}

async function assertSafeProspectivePath(rootPath: string, targetRelative: string): Promise<void> {
  const lexicalRoot = path.resolve(rootPath)
  resolveInsideRoot(lexicalRoot, targetRelative)
  const rootInfo = await lstat(lexicalRoot)
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) {
    throw new Error("Native extension root must be a real directory")
  }
  const realRoot = await realpath(lexicalRoot)
  const target = resolveInsideRoot(realRoot, targetRelative)
  const parts = path.relative(realRoot, target).split(path.sep).filter(Boolean)
  let current = realRoot
  for (const part of parts) {
    current = path.join(current, part)
    try {
      const info = await lstat(current)
      if (info.isSymbolicLink()) throw new Error("Native extension path contains a symbolic link")
      if (current !== target && !info.isDirectory()) {
        throw new Error("Native extension parent is not a directory")
      }
      if (current === target && !info.isFile()) {
        throw new Error("Native extension target must be a real file")
      }
    } catch (error) {
      if (isMissing(error)) return
      throw error
    }
  }
}

function parseMatter(raw: string): { data: Record<string, unknown>; content: string } {
  try {
    const parsed = matter(raw)
    if (!parsed.data || typeof parsed.data !== "object" || Array.isArray(parsed.data)) {
      throw new Error("Frontmatter must be an object")
    }
    return { data: parsed.data as Record<string, unknown>, content: parsed.content }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Native extension frontmatter is malformed: ${message}`)
  }
}

function serializeMatter(content: string, metadata: Record<string, unknown>): string {
  if (Object.keys(metadata).length === 0) return content
  return matter.stringify(content, metadata)
}

function nativePathTemplate(
  adapterDefinition: NativeAdapterDefinition,
  target: NativeExtensionTarget,
): string {
  const root = target.scope === "user" ? adapterDefinition.userRoot : adapterDefinition.projectRoot
  if (!root) return ""
  const prefix = target.scope === "user" ? "~" : "<project>"
  const file =
    adapterDefinition.shape === "skill-directory" ? `${target.name}/SKILL.md` : `${target.name}.md`
  return [prefix, ...root, file].join("/")
}

function validateName(value: string): void {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
    throw new Error("Native extension name must use lowercase letters, numbers, and single hyphens")
  }
}

function targetLock(targetPath: string): Mutex {
  let mutex = mutationLocks.get(targetPath)
  if (!mutex) {
    mutex = new Mutex()
    mutationLocks.set(targetPath, mutex)
  }
  return mutex
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
}
