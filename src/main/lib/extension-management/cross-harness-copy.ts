import { createHash } from "node:crypto"
import { z } from "zod"
import {
  applyNativeExtensionMutation,
  getNativeExtensionAdapterDescriptor,
  nativeExtensionTargetSchema,
  previewNativeExtensionMutation,
  readNativeExtension,
  restoreNativeExtensionBackup,
  validateNativeExtensionMetadata,
  type NativeExtensionDocument,
  type NativeExtensionMutation,
  type NativeExtensionMutationResult,
  type NativeExtensionTarget,
} from "./native-adapters"
import {
  extensionCapabilityId,
  extensionCapabilityRegistry,
  type ExtensionCapability,
} from "./capability-registry"

export const PORTABLE_EXTENSION_MANIFEST_SCHEMA_VERSION = 1 as const
export const CROSS_HARNESS_COPY_SCHEMA_VERSION = 1 as const

const MAX_PORTABLE_NODES = 10_000
const MAX_PORTABLE_DEPTH = 20
const unsafePortableKeys = new Set(["__proto__", "constructor", "prototype"])
const hostOnlyPortableKeys = new Set([
  "absolutepath",
  "afterhash",
  "backup",
  "backupid",
  "backuppath",
  "backupreference",
  "beforehash",
  "confirmationhash",
  "createdat",
  "cwd",
  "filehash",
  "filepath",
  "hash",
  "nativepath",
  "path",
  "relativepath",
  "runtime",
  "runtimeconsumption",
  "runtimereload",
  "runtimestate",
  "sourcehash",
  "sourceid",
  "sourcepath",
  "targethash",
  "targetpath",
  "updatedat",
])

const portableMetadataSchema = z.record(z.string(), z.unknown())

export const portableExtensionManifestSchema = z
  .object({
    schemaVersion: z.literal(PORTABLE_EXTENSION_MANIFEST_SCHEMA_VERSION),
    origin: z
      .object({
        harness: nativeExtensionTargetSchema.shape.harness,
        kind: nativeExtensionTargetSchema.shape.kind,
        scope: nativeExtensionTargetSchema.shape.scope,
      })
      .strict(),
    kind: nativeExtensionTargetSchema.shape.kind,
    name: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    content: z.string().max(1_000_000),
    metadata: portableMetadataSchema,
  })
  .strict()

export const crossHarnessCopyPreviewSchema = z.object({
  source: nativeExtensionTargetSchema,
  target: nativeExtensionTargetSchema,
  collisionPolicy: z.enum(["reject", "overwrite"]).default("reject"),
})

export const crossHarnessCopyApplySchema = crossHarnessCopyPreviewSchema.extend({
  expectedSourceHash: z.string().length(64),
  expectedTargetHash: z.string().length(64).nullable(),
  confirmationHash: z.string().length(64),
})

export type PortableExtensionManifest = z.infer<typeof portableExtensionManifestSchema>
export type CrossHarnessCopyPreviewInput = z.infer<typeof crossHarnessCopyPreviewSchema>
export type CrossHarnessCopyApplyInput = z.infer<typeof crossHarnessCopyApplySchema>
export type CrossHarnessCopyStatus = "exact" | "converted" | "unsupported"

export type CrossHarnessCopyPreview = {
  schemaVersion: typeof CROSS_HARNESS_COPY_SCHEMA_VERSION
  status: CrossHarnessCopyStatus
  canApply: boolean
  sourceCapability: ExtensionCapability
  targetCapability: ExtensionCapability
  sourceHash: string | null
  targetBeforeHash: string | null
  targetAfterHash: string | null
  targetPath: string | null
  targetDiff: string
  collision: {
    exists: boolean
    policy: CrossHarnessCopyPreviewInput["collisionPolicy"]
    action: "create" | "overwrite" | "blocked" | "unsupported"
  }
  unsupportedFields: string[]
  preservedTargetFields: string[]
  reasons: string[]
  portableManifest: PortableExtensionManifest | null
  confirmationHash: string | null
}

export type CrossHarnessCopyResult = CrossHarnessCopyPreview & {
  mutation: NativeExtensionMutationResult
  sourcePreserved: true
}

type CopyOptions = {
  homeDir?: string
  beforeCommit?: (targetPath: string) => void | Promise<void>
  afterCommit?: (targetPath: string) => void | Promise<void>
}

export function sanitizePortableExtensionManifest(input: unknown): PortableExtensionManifest {
  const parsed = portableExtensionManifestSchema.parse(input)
  const budget = { nodes: 0 }
  return {
    ...parsed,
    metadata: sanitizePortableRecord(parsed.metadata, "metadata", 0, budget),
  }
}

export async function previewCrossHarnessCopy(
  inputValue: CrossHarnessCopyPreviewInput,
  options: Pick<CopyOptions, "homeDir"> = {},
): Promise<CrossHarnessCopyPreview> {
  const input = crossHarnessCopyPreviewSchema.parse(inputValue)
  const sourceCapability = capabilityFor(input.source)
  const targetCapability = capabilityFor(input.target)
  const reasons: string[] = []

  if (input.source.harness === input.target.harness) {
    reasons.push("Cross-harness copy requires different source and target harnesses")
  }
  if (input.source.kind !== input.target.kind) {
    reasons.push("Cross-harness copy does not translate between extension kinds")
  }
  if (!sourceCapability || sourceCapability.inventory === "unsupported") {
    reasons.push("The source capability is unsupported")
  }
  if (!targetCapability || !targetCapability.mutations.includes("create")) {
    reasons.push("The target capability cannot create native extensions")
  }

  if (!sourceCapability || !targetCapability) {
    throw new Error("Extension capability registry is incomplete")
  }

  let sourceAdapter: ReturnType<typeof getNativeExtensionAdapterDescriptor> | null = null
  let targetAdapter: ReturnType<typeof getNativeExtensionAdapterDescriptor> | null = null
  try {
    sourceAdapter = getNativeExtensionAdapterDescriptor(input.source)
  } catch {
    reasons.push("No native source adapter is registered")
  }
  try {
    targetAdapter = getNativeExtensionAdapterDescriptor(input.target)
  } catch {
    reasons.push("No native target adapter is registered")
  }

  if (reasons.length || !sourceAdapter || !targetAdapter) {
    return unsupportedPreview(input, sourceCapability, targetCapability, reasons)
  }

  const source = await readNativeExtension(input.source, options)
  const unsupportedFields = Object.keys(source.metadata)
    .filter((field) => !targetAdapter!.knownFields.includes(field))
    .sort()
  if (unsupportedFields.length) {
    reasons.push("Source metadata has no declared target-harness equivalent")
  }

  const targetMetadata = Object.fromEntries(
    Object.entries(source.metadata).filter(([field]) => targetAdapter!.knownFields.includes(field)),
  )
  let converted = input.source.name !== input.target.name
  if (input.target.kind === "skill") {
    converted ||= targetMetadata.name !== input.target.name
    targetMetadata.name = input.target.name
  }
  if (input.target.kind === "custom-agent" && "name" in targetMetadata) {
    converted ||= targetMetadata.name !== input.target.name
    targetMetadata.name = input.target.name
  }

  const targetMetadataValidation = validateNativeExtensionMetadata(input.target, targetMetadata)
  if (!targetMetadataValidation.valid) {
    reasons.push(`Target metadata is not convertible: ${targetMetadataValidation.reason}`)
  }

  let portableManifest: PortableExtensionManifest | null = null
  if (!unsupportedFields.length && targetMetadataValidation.valid) {
    try {
      portableManifest = sanitizePortableExtensionManifest({
        schemaVersion: PORTABLE_EXTENSION_MANIFEST_SCHEMA_VERSION,
        origin: {
          harness: input.source.harness,
          kind: input.source.kind,
          scope: input.source.scope,
        },
        kind: input.target.kind,
        name: input.target.name,
        content: source.content,
        metadata: targetMetadata,
      })
    } catch (error) {
      reasons.push(
        `Portable manifest rejected unsafe metadata: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  if (reasons.length || !portableManifest) {
    return unsupportedPreview(input, sourceCapability, targetCapability, reasons, {
      sourceHash: source.hash,
      unsupportedFields,
    })
  }

  const existingTarget = await readOptionalNativeExtension(input.target, options)
  const collisionExists = existingTarget !== null
  const preservedTargetFields = existingTarget?.unknownFields ?? []
  const operation: NativeExtensionMutation["operation"] = collisionExists ? "update" : "create"
  const mutation: NativeExtensionMutation = {
    operation,
    target: input.target,
    changes: {
      content: portableManifest.content,
      metadata: portableManifest.metadata,
      removeMetadata: existingTarget
        ? targetAdapter.knownFields.filter(
            (field) =>
              Object.hasOwn(existingTarget.metadata, field) &&
              !Object.hasOwn(portableManifest.metadata, field),
          )
        : undefined,
    },
  }
  const targetPreview = await previewNativeExtensionMutation(mutation, options)
  const blocked = collisionExists && input.collisionPolicy === "reject"
  const status: CrossHarnessCopyStatus = converted ? "converted" : "exact"
  const previewBase = {
    schemaVersion: CROSS_HARNESS_COPY_SCHEMA_VERSION,
    status,
    canApply: !blocked,
    sourceCapability,
    targetCapability,
    sourceHash: source.hash,
    targetBeforeHash: targetPreview.beforeHash,
    targetAfterHash: targetPreview.afterHash,
    targetPath: targetPreview.path,
    targetDiff: targetPreview.diff,
    collision: {
      exists: collisionExists,
      policy: input.collisionPolicy,
      action: blocked
        ? ("blocked" as const)
        : collisionExists
          ? ("overwrite" as const)
          : ("create" as const),
    },
    unsupportedFields: [],
    preservedTargetFields,
    reasons: blocked ? ["Target exists and collision policy rejects overwrite"] : [],
    portableManifest,
  }
  return {
    ...previewBase,
    confirmationHash: copyConfirmationHash(previewBase),
  }
}

export async function applyCrossHarnessCopy(
  inputValue: CrossHarnessCopyApplyInput,
  options: CopyOptions = {},
): Promise<CrossHarnessCopyResult> {
  const input = crossHarnessCopyApplySchema.parse(inputValue)
  const preview = await previewCrossHarnessCopy(input, options)
  if (!preview.canApply || preview.status === "unsupported" || !preview.portableManifest) {
    throw new Error(preview.reasons.join("; ") || "Cross-harness copy is not applicable")
  }
  if (preview.sourceHash !== input.expectedSourceHash) {
    throw new Error("Source extension changed after copy preview")
  }
  if (preview.targetBeforeHash !== input.expectedTargetHash) {
    throw new Error("Target extension changed after copy preview")
  }
  if (preview.confirmationHash !== input.confirmationHash) {
    throw new Error("Cross-harness copy preview confirmation is stale or invalid")
  }

  const mutation: NativeExtensionMutation = {
    operation: preview.collision.exists ? "update" : "create",
    target: input.target,
    changes: {
      content: preview.portableManifest.content,
      metadata: preview.portableManifest.metadata,
      removeMetadata: preview.collision.exists
        ? removableTargetFields(
            input.target,
            await readNativeExtension(input.target, options),
            preview.portableManifest.metadata,
          )
        : undefined,
    },
  }
  const nativePreview = await previewNativeExtensionMutation(mutation, options)
  const result = await applyNativeExtensionMutation(
    {
      ...mutation,
      expectedHash: preview.targetBeforeHash,
      confirmationHash: nativePreview.confirmationHash,
    },
    options,
  )

  try {
    const sourceAfter = await readNativeExtension(input.source, options)
    if (sourceAfter.hash !== preview.sourceHash) {
      throw new Error("Source extension changed during cross-harness copy")
    }
  } catch (error) {
    if (!result.backup) throw error
    try {
      await restoreNativeExtensionBackup(
        { target: input.target, backupId: result.backup.backupId },
        options,
      )
    } catch (rollbackError) {
      throw new AggregateError(
        [error, rollbackError],
        "Cross-harness copy failed and target rollback could not be completed",
      )
    }
    throw error
  }

  return { ...preview, mutation: result, sourcePreserved: true }
}

function capabilityFor(target: NativeExtensionTarget): ExtensionCapability | undefined {
  return extensionCapabilityRegistry.find(
    (candidate) =>
      candidate.id === extensionCapabilityId(target.harness, target.kind, target.scope),
  )
}

function unsupportedPreview(
  input: CrossHarnessCopyPreviewInput,
  sourceCapability: ExtensionCapability,
  targetCapability: ExtensionCapability,
  reasons: string[],
  details: { sourceHash?: string; unsupportedFields?: string[] } = {},
): CrossHarnessCopyPreview {
  return {
    schemaVersion: CROSS_HARNESS_COPY_SCHEMA_VERSION,
    status: "unsupported",
    canApply: false,
    sourceCapability,
    targetCapability,
    sourceHash: details.sourceHash ?? null,
    targetBeforeHash: null,
    targetAfterHash: null,
    targetPath: null,
    targetDiff: "",
    collision: {
      exists: false,
      policy: input.collisionPolicy,
      action: "unsupported",
    },
    unsupportedFields: details.unsupportedFields ?? [],
    preservedTargetFields: [],
    reasons: [...new Set(reasons)],
    portableManifest: null,
    confirmationHash: null,
  }
}

function removableTargetFields(
  target: NativeExtensionTarget,
  existing: NativeExtensionDocument,
  portableMetadata: Record<string, unknown>,
): string[] {
  const adapter = getNativeExtensionAdapterDescriptor(target)
  return adapter.knownFields.filter(
    (field) => Object.hasOwn(existing.metadata, field) && !Object.hasOwn(portableMetadata, field),
  )
}

async function readOptionalNativeExtension(
  target: NativeExtensionTarget,
  options: Pick<CopyOptions, "homeDir">,
): Promise<NativeExtensionDocument | null> {
  try {
    return await readNativeExtension(target, options)
  } catch (error) {
    if (error instanceof Error && error.message === "Native extension file does not exist") {
      return null
    }
    throw error
  }
}

function copyConfirmationHash(value: object): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

function sanitizePortableRecord(
  value: Record<string, unknown>,
  fieldPath: string,
  depth: number,
  budget: { nodes: number },
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => {
      if (unsafePortableKeys.has(key)) {
        throw new Error(`${fieldPath}.${key} is not portable`)
      }
      if (hostOnlyPortableKeys.has(normalizePortableKey(key))) {
        throw new Error(`${fieldPath}.${key} is host-only and cannot be exported`)
      }
      return [key, sanitizePortableValue(entry, `${fieldPath}.${key}`, depth + 1, budget)]
    }),
  )
}

function normalizePortableKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "")
}

function sanitizePortableValue(
  value: unknown,
  fieldPath: string,
  depth: number,
  budget: { nodes: number },
): unknown {
  budget.nodes += 1
  if (budget.nodes > MAX_PORTABLE_NODES) throw new Error("Portable metadata is too large")
  if (depth > MAX_PORTABLE_DEPTH) throw new Error("Portable metadata is too deeply nested")
  if (value === null || typeof value === "string" || typeof value === "boolean") return value
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (Array.isArray(value)) {
    return value.map((entry, index) =>
      sanitizePortableValue(entry, `${fieldPath}[${index}]`, depth + 1, budget),
    )
  }
  if (typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error(`${fieldPath} must be JSON-compatible data`)
  }
  return sanitizePortableRecord(value as Record<string, unknown>, fieldPath, depth, budget)
}
