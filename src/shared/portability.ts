import { z } from "zod"

export const PORTABLE_BUNDLE_FORMAT = "flapstack-portable-bundle" as const
export const PORTABLE_BUNDLE_VERSION = 1 as const
export const PORTABLE_CHECKSUM_VERSION = 1 as const
export const PORTABLE_EXCLUSION_VERSION = 1 as const

export const PORTABLE_SCOPE_IDS = [
  "settings",
  "projects",
  "extensions",
  "project-vaults",
  "saved-workspaces",
  "usage",
  "history",
] as const

export const PORTABLE_SENSITIVITY_CLASSES = ["public", "private", "secret-bearing"] as const
export const PORTABLE_STORAGE_KINDS = ["database", "files", "hybrid"] as const
export const PORTABLE_PROJECT_FILTER_MODES = ["none", "optional"] as const

export const PORTABLE_BUNDLE_LAYOUT = {
  manifest: "manifest.json",
  database: "database/flapstack.sqlite3",
  checksums: "checksums.json",
  exclusions: "exclusions.json",
  scopesRoot: "scopes",
} as const

export const PORTABILITY_LIMITS = {
  bundleNameBytes: 240,
  appVersionBytes: 128,
  scopeCount: 32,
  projectFilterCount: 1_024,
  projectIdBytes: 200,
  relativePathBytes: 4_096,
  checksumEntries: 4_096,
  exclusionEntries: 4_096,
  exclusionReasonBytes: 1_024,
} as const

export type PortableScopeId = (typeof PORTABLE_SCOPE_IDS)[number]
export type PortableSensitivityClass = (typeof PORTABLE_SENSITIVITY_CLASSES)[number]
export type PortableStorageKind = (typeof PORTABLE_STORAGE_KINDS)[number]
export type PortableProjectFilterMode = (typeof PORTABLE_PROJECT_FILTER_MODES)[number]

const portableIdentifierSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z][a-z0-9-]*$/, "Portable identifiers must be lowercase kebab-case.")

const utf8Bytes = (value: string): number => new TextEncoder().encode(value).byteLength
const withinUtf8Bytes =
  (limit: number) =>
  (value: string): boolean =>
    utf8Bytes(value) <= limit
const windowsDeviceSegment = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i

export function portableCollisionKey(value: string): string {
  return value.normalize("NFC").toLocaleLowerCase("en-US")
}

export const portableBundleDirectoryNameSchema = z
  .string()
  .min("x.flapstack-export".length)
  .max(PORTABILITY_LIMITS.bundleNameBytes)
  .refine(
    withinUtf8Bytes(PORTABILITY_LIMITS.bundleNameBytes),
    "Bundle directory name is too large.",
  )
  .refine((value) => value === value.trim(), "Bundle directory names cannot have edge spaces.")
  .refine(
    (value) => /^[\p{L}\p{N}][\p{L}\p{N}._ -]*\.flapstack-export$/u.test(value),
    "Bundle directory names must be one safe path segment ending in .flapstack-export.",
  )
  .refine((value) => !value.includes(".."), "Bundle directory names cannot contain dot traversal.")
  .refine(
    (value) => !windowsDeviceSegment.test(value),
    "Bundle directory name is reserved on Windows.",
  )

export const safeRelativeBundlePathSchema = z
  .string()
  .min(1)
  .max(PORTABILITY_LIMITS.relativePathBytes)
  .refine(withinUtf8Bytes(PORTABILITY_LIMITS.relativePathBytes), "Bundle path is too large.")
  .refine((value) => value === value.trim(), "Bundle paths cannot have edge spaces.")
  .refine(
    (value) => !/[\\\0\u0000-\u001f\u007f]/.test(value),
    "Bundle paths contain unsafe characters.",
  )
  .refine(
    (value) => !value.startsWith("/") && !value.includes(":"),
    "Bundle paths must be relative.",
  )
  .refine((value) => {
    const segments = value.split("/")
    return segments.every(
      (segment) =>
        segment.length > 0 &&
        segment !== "." &&
        segment !== ".." &&
        segment === segment.trim() &&
        !segment.endsWith(".") &&
        !windowsDeviceSegment.test(segment) &&
        !/%(?:2e|2f|5c)/i.test(segment),
    )
  }, "Bundle paths must use canonical safe segments.")

export const portableProjectIdSchema = z
  .string()
  .min(1)
  .max(PORTABILITY_LIMITS.projectIdBytes)
  .refine(withinUtf8Bytes(PORTABILITY_LIMITS.projectIdBytes), "Project ID is too large.")
  .refine((value) => value === value.trim(), "Project IDs cannot have edge spaces.")
  .refine((value) => ![/[\\/]/, /[\u0000-\u001f\u007f]/].some((pattern) => pattern.test(value)), {
    message: "Project IDs cannot contain path separators or control characters.",
  })

export const portableManifestScopeSchema = z
  .object({
    id: portableIdentifierSchema,
    schemaVersion: z.number().int().positive(),
    contentPath: safeRelativeBundlePathSchema,
    projectIds: z
      .array(portableProjectIdSchema)
      .min(1)
      .max(PORTABILITY_LIMITS.projectFilterCount)
      .optional(),
  })
  .strict()

export const portableManifestSchema = z
  .object({
    format: z.literal(PORTABLE_BUNDLE_FORMAT),
    bundleVersion: z.number().int().positive(),
    directoryName: portableBundleDirectoryNameSchema,
    createdAt: z.string().datetime({ offset: true }),
    appVersion: z
      .string()
      .min(1)
      .max(PORTABILITY_LIMITS.appVersionBytes)
      .refine(withinUtf8Bytes(PORTABILITY_LIMITS.appVersionBytes), "App version is too large."),
    layout: z
      .object({
        database: safeRelativeBundlePathSchema,
        checksums: safeRelativeBundlePathSchema,
        exclusions: safeRelativeBundlePathSchema,
        scopesRoot: safeRelativeBundlePathSchema,
      })
      .strict(),
    scopes: z.array(portableManifestScopeSchema).min(1).max(PORTABILITY_LIMITS.scopeCount),
  })
  .strict()

export const portableChecksumEntrySchema = z
  .object({
    path: safeRelativeBundlePathSchema,
    sha256: z.string().regex(/^[a-f0-9]{64}$/, "SHA-256 digests must be lowercase hex."),
    bytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  })
  .strict()

export const portableChecksumDocumentSchema = z
  .object({
    schemaVersion: z.number().int().positive(),
    algorithm: z.literal("sha256"),
    entries: z.array(portableChecksumEntrySchema).max(PORTABILITY_LIMITS.checksumEntries),
  })
  .strict()

export const PORTABLE_EXCLUSION_CATEGORIES = [
  "credential",
  "token",
  "session",
  "webhook",
  "private-key",
  "machine-policy",
  "local-path",
  "unsupported",
  "user-excluded",
  "secret-candidate",
] as const

export const portableExclusionEntrySchema = z
  .object({
    scopeId: portableIdentifierSchema,
    path: safeRelativeBundlePathSchema.optional(),
    category: z.enum(PORTABLE_EXCLUSION_CATEGORIES),
    sensitivity: z.enum(PORTABLE_SENSITIVITY_CLASSES),
    reason: z
      .string()
      .min(1)
      .max(PORTABILITY_LIMITS.exclusionReasonBytes)
      .refine(
        withinUtf8Bytes(PORTABILITY_LIMITS.exclusionReasonBytes),
        "Exclusion reason is too large.",
      ),
  })
  .strict()

export const portableExclusionDocumentSchema = z
  .object({
    schemaVersion: z.number().int().positive(),
    entries: z.array(portableExclusionEntrySchema).max(PORTABILITY_LIMITS.exclusionEntries),
  })
  .strict()

export type PortableManifestScope = z.infer<typeof portableManifestScopeSchema>
export type PortableManifest = z.infer<typeof portableManifestSchema>
export type PortableChecksumEntry = z.infer<typeof portableChecksumEntrySchema>
export type PortableChecksumDocument = z.infer<typeof portableChecksumDocumentSchema>
export type PortableExclusionEntry = z.infer<typeof portableExclusionEntrySchema>
export type PortableExclusionDocument = z.infer<typeof portableExclusionDocumentSchema>
