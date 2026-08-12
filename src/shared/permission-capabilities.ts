import { z, type RefinementCtx } from "zod"
import type { AgentHarness, RunPermissionMode } from "./harness-types"

export const CUSTOM_PERMISSION_SCHEMA_VERSION = 1 as const

export type CustomPermissionCapabilities = {
  schemaVersion: typeof CUSTOM_PERMISSION_SCHEMA_VERSION
  projectWrite: boolean
  shell: boolean
  network: boolean
  git: boolean
  browser: boolean
  secrets: boolean
  subagents: boolean
  thirdPartyMcp: boolean
  productMcpRead: boolean
  productMcpWrite: boolean
  productMcpTier3: boolean
}

export const customPermissionCapabilityKeys = [
  "projectWrite",
  "shell",
  "network",
  "git",
  "browser",
  "secrets",
  "subagents",
  "thirdPartyMcp",
  "productMcpRead",
  "productMcpWrite",
  "productMcpTier3",
] as const satisfies readonly (keyof Omit<CustomPermissionCapabilities, "schemaVersion">)[]

export const customPermissionCapabilitiesSchema = z
  .object({
    schemaVersion: z.literal(CUSTOM_PERMISSION_SCHEMA_VERSION),
    projectWrite: z.boolean(),
    shell: z.boolean(),
    network: z.boolean(),
    git: z.boolean(),
    browser: z.boolean(),
    secrets: z.boolean(),
    subagents: z.boolean(),
    thirdPartyMcp: z.boolean(),
    productMcpRead: z.boolean(),
    productMcpWrite: z.boolean(),
    productMcpTier3: z.boolean(),
  })
  .strict()

export function refineCustomPermissionMode(
  value: { permissionMode: string; customPermissions?: unknown | null },
  context: RefinementCtx,
): void {
  if (value.permissionMode === "custom" && !value.customPermissions) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["customPermissions"],
      message: "Custom permission mode requires explicit capabilities.",
    })
  }
  if (value.permissionMode !== "custom" && value.customPermissions) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["customPermissions"],
      message: "Custom capabilities require custom permission mode.",
    })
  }
}

export const disabledCustomPermissions: CustomPermissionCapabilities = {
  schemaVersion: CUSTOM_PERMISSION_SCHEMA_VERSION,
  projectWrite: false,
  shell: false,
  network: false,
  git: false,
  browser: false,
  secrets: false,
  subagents: false,
  thirdPartyMcp: false,
  productMcpRead: false,
  productMcpWrite: false,
  productMcpTier3: false,
}

type LegacyCustomPermissions = {
  fileWrite: boolean
  shell: boolean
  network: boolean
  git: boolean
  browser: boolean
  mcp: boolean
  secrets: boolean
}

const legacyKeys = ["fileWrite", "shell", "network", "git", "browser", "mcp", "secrets"]

export function parseCustomPermissionCapabilities(
  value: unknown,
): CustomPermissionCapabilities | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const record = value as Record<string, unknown>

  if (record.schemaVersion === CUSTOM_PERMISSION_SCHEMA_VERSION) {
    const allowedKeys = new Set(["schemaVersion", ...customPermissionCapabilityKeys])
    if (Object.keys(record).some((key) => !allowedKeys.has(key))) return null
    if (!customPermissionCapabilityKeys.every((key) => typeof record[key] === "boolean")) {
      return null
    }
    return {
      schemaVersion: CUSTOM_PERMISSION_SCHEMA_VERSION,
      ...Object.fromEntries(customPermissionCapabilityKeys.map((key) => [key, record[key]])),
    } as CustomPermissionCapabilities
  }

  if (
    Object.keys(record).length === legacyKeys.length &&
    legacyKeys.every((key) => typeof record[key] === "boolean")
  ) {
    const legacy = record as LegacyCustomPermissions
    return {
      ...disabledCustomPermissions,
      projectWrite: legacy.fileWrite,
      shell: legacy.shell,
      network: legacy.network,
      git: legacy.git,
      browser: legacy.browser,
      secrets: legacy.secrets,
      thirdPartyMcp: legacy.mcp,
      productMcpRead: legacy.mcp,
    }
  }

  return null
}

export function parseStoredCustomPermissionCapabilities(
  value: unknown,
): CustomPermissionCapabilities | null {
  if (typeof value !== "string" || !value) return null
  try {
    return parseCustomPermissionCapabilities(JSON.parse(value))
  } catch {
    return null
  }
}

export type PermissionEligibility = {
  selectable: boolean
  enforcement: "exact" | "conservative" | "best-effort" | "unavailable"
  reason: string
}

export function getPermissionEligibility(
  harness: AgentHarness | null | undefined,
  mode: RunPermissionMode,
): PermissionEligibility {
  if (mode === "read-only" || mode === "ask-before-edits" || mode === "full-access") {
    return {
      selectable: true,
      enforcement: mode === "ask-before-edits" ? "conservative" : "exact",
      reason: "This provider has a tested native or fail-closed mapping for the mode.",
    }
  }

  if (mode === "auto-edit-project-only") {
    if (harness === "codex") {
      return {
        selectable: true,
        enforcement: "exact",
        reason:
          "Codex ACP workspace-write excludes temporary roots; live proof auto-writes inside and asks outside the project.",
      }
    }
    return {
      selectable: false,
      enforcement: harness ? "best-effort" : "unavailable",
      reason: harness
        ? "This provider exposes only cwd, classifier, or unproved sandbox hints."
        : "Choose a provider before selecting project-only mode.",
    }
  }

  if (mode === "custom") {
    return {
      selectable: Boolean(harness),
      enforcement: harness ? "conservative" : "unavailable",
      reason:
        harness === "cursor-agent"
          ? "Cursor custom mode fails closed to its sandboxed plan preset when a toggle lacks a native control."
          : harness
            ? "Capabilities map to tested provider controls or a fail-closed Flapstack bridge; native parity is not claimed."
            : "Choose a provider before configuring custom capabilities.",
    }
  }

  return { selectable: false, enforcement: "unavailable", reason: "Unsupported mode." }
}
