import { randomUUID } from "node:crypto"
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { z } from "zod"
import {
  ALWAYS_VISIBLE_FEATURE_IDS,
  FEATURE_VISIBILITY_REGISTRY,
  previewVisibilityPreset,
  type FeatureVisibilityPreset,
} from "../../../shared/feature-visibility"

const visibilitySchema = z.record(z.string().min(1).max(120), z.boolean())
const persistedSchema = z
  .object({
    version: z.literal(1),
    revision: z.number().int().nonnegative(),
    status: z.enum(["pending-onboarding", "upgrade-preserved", "configured"]),
    preset: z.enum(["focused", "standard", "complete"]).nullable(),
    visibility: visibilitySchema,
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.status === "configured") !== (value.preset !== null)) {
      context.addIssue({
        code: "custom",
        message: "Configured visibility requires a preset and pending visibility cannot have one.",
      })
    }
  })

export type FeatureVisibilitySnapshot = {
  version: 1
  revision: number
  status: "pending-onboarding" | "upgrade-preserved" | "configured" | "repair-required"
  preset: FeatureVisibilityPreset | null
  visibility: Record<string, boolean>
}

export class FeatureVisibilityConflictError extends Error {
  constructor(readonly actualRevision: number) {
    super(`Feature visibility changed in another window (revision ${actualRevision}).`)
    this.name = "FeatureVisibilityConflictError"
  }
}

export class FeatureVisibilityStore {
  constructor(
    private readonly options: {
      path: string
      profileKind: "fresh" | "existing"
      freshProfilePreset?: FeatureVisibilityPreset
    },
  ) {}

  initialize(): FeatureVisibilitySnapshot {
    const current = this.read()
    if (current.status === "repair-required") {
      throw new Error("Feature visibility preferences require repair before initialization.")
    }
    if (current.revision > 0 || fileExists(this.options.path)) {
      return current
    }

    mkdirSync(dirname(this.options.path), { recursive: true })
    try {
      writeFileSync(this.options.path, `${JSON.stringify(current, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      })
      return current
    } catch (error) {
      if (isAlreadyExists(error)) return this.read()
      throw error
    }
  }

  read(): FeatureVisibilitySnapshot {
    try {
      const parsed = persistedSchema.parse(JSON.parse(readFileSync(this.options.path, "utf8")))
      const visibility = normalizePersistedVisibility(parsed.visibility)
      return {
        version: 1,
        revision: parsed.revision,
        status: parsed.status,
        preset: parsed.preset,
        visibility,
      }
    } catch (error) {
      if (isMissingFile(error)) return this.initialSnapshot()
      return {
        ...this.initialSnapshot(),
        status: "repair-required",
      }
    }
  }

  isVisible(featureId: string): boolean {
    if (ALWAYS_VISIBLE_FEATURE_IDS.includes(featureId as never)) return true
    return this.read().visibility[featureId] ?? true
  }

  apply(input: {
    expectedRevision: number
    preset: FeatureVisibilityPreset
    visibility: Readonly<Record<string, boolean>>
  }): FeatureVisibilitySnapshot {
    const current = this.read()
    if (current.status === "repair-required") {
      throw new Error("Feature visibility preferences require repair before changes can be saved.")
    }
    if (current.revision !== input.expectedRevision) {
      throw new FeatureVisibilityConflictError(current.revision)
    }
    const visibility = validateVisibilityWrite(input.visibility)
    const persisted = {
      version: 1 as const,
      revision: current.revision + 1,
      status: "configured" as const,
      preset: input.preset,
      visibility,
    }
    atomicWriteJson(this.options.path, persisted)
    return {
      ...persisted,
    }
  }

  private initialSnapshot(): FeatureVisibilitySnapshot {
    const visibility = Object.fromEntries(
      FEATURE_VISIBILITY_REGISTRY.map((entry) => [entry.id, true]),
    )
    if (this.options.profileKind === "fresh" && this.options.freshProfilePreset) {
      return {
        version: 1,
        revision: 0,
        status: "configured",
        preset: this.options.freshProfilePreset,
        visibility: previewVisibilityPreset(visibility, this.options.freshProfilePreset).result,
      }
    }
    return {
      version: 1,
      revision: 0,
      status: this.options.profileKind === "fresh" ? "pending-onboarding" : "upgrade-preserved",
      preset: null,
      visibility,
    }
  }
}

function normalizePersistedVisibility(
  persisted: Readonly<Record<string, boolean>>,
): Record<string, boolean> {
  for (const featureId of ALWAYS_VISIBLE_FEATURE_IDS) {
    if (persisted[featureId] === false) {
      throw new Error(`Always-visible feature cannot be hidden: ${featureId}`)
    }
  }
  return {
    ...Object.fromEntries(FEATURE_VISIBILITY_REGISTRY.map((entry) => [entry.id, true])),
    ...persisted,
  }
}

function validateVisibilityWrite(
  requested: Readonly<Record<string, boolean>>,
): Record<string, boolean> {
  const optionalIds = new Set(FEATURE_VISIBILITY_REGISTRY.map((entry) => entry.id))
  const normalized: Record<string, boolean> = {}
  for (const [id, visible] of Object.entries(requested)) {
    if (optionalIds.has(id as never)) {
      normalized[id] = visible
      continue
    }
    if (visible === true && !ALWAYS_VISIBLE_FEATURE_IDS.includes(id as never)) {
      normalized[id] = true
      continue
    }
    throw new Error(`Cannot write unknown or always-visible feature state: ${id}`)
  }
  for (const id of optionalIds) {
    if (typeof normalized[id] !== "boolean") {
      throw new Error(`Missing optional feature visibility: ${id}`)
    }
  }
  return normalized
}

function atomicWriteJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    })
    renameSync(temporaryPath, path)
  } finally {
    rmSync(temporaryPath, { force: true })
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT"
  )
}

function isAlreadyExists(error: unknown): boolean {
  return (
    error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "EEXIST"
  )
}

function fileExists(path: string): boolean {
  try {
    readFileSync(path)
    return true
  } catch (error) {
    if (isMissingFile(error)) return false
    throw error
  }
}
