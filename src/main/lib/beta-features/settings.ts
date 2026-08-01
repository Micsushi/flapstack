import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unwatchFile,
  watchFile,
  writeFileSync,
} from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import {
  DEFAULT_BETA_FEATURE_SETTINGS,
  normalizeBetaFeatureSettings,
  type BetaFeatureId,
  type BetaFeatureSettings,
} from "../../../shared/beta-features"

const require = createRequire(import.meta.url)
const configFileName = "beta-features.json"
const listeners = new Set<(settings: BetaFeatureSettings) => void>()
let watchedPath: string | null = null
let lastNotifiedJson: string | null = null

// Notify listeners only when settings actually changed, so a direct write and
// its watchFile echo don't fire twice for the same value.
function notifyListeners(settings: BetaFeatureSettings): void {
  const json = JSON.stringify(settings)
  if (json === lastNotifiedJson) return
  lastNotifiedJson = json
  for (const listener of listeners) listener(settings)
}

export function getBetaFeatureSettings(): BetaFeatureSettings {
  const path = getBetaFeatureSettingsPath()
  if (!existsSync(path)) return { ...DEFAULT_BETA_FEATURE_SETTINGS }
  try {
    return normalizeBetaFeatureSettings(
      JSON.parse(readFileSync(path, "utf8")) as Partial<Record<BetaFeatureId, unknown>>,
    )
  } catch (error) {
    console.warn("[Beta features] Failed to read settings:", error)
    return { ...DEFAULT_BETA_FEATURE_SETTINGS }
  }
}

export function isBetaFeatureEnabled(feature: BetaFeatureId): boolean {
  return getBetaFeatureSettings()[feature]
}

export function setBetaFeatureEnabled(
  feature: BetaFeatureId,
  enabled: boolean,
): BetaFeatureSettings {
  const next = normalizeBetaFeatureSettings({
    ...getBetaFeatureSettings(),
    [feature]: enabled,
  })
  const path = getBetaFeatureSettingsPath()
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`
  writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 })
  renameSync(temporary, path)
  notifyListeners(next)
  return next
}

export function subscribeBetaFeatureSettings(
  listener: (settings: BetaFeatureSettings) => void,
): () => void {
  listeners.add(listener)
  ensureSettingsWatcher()
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && watchedPath) {
      unwatchFile(watchedPath)
      watchedPath = null
    }
  }
}

export function betaFeatureForTrpcPath(path: string): BetaFeatureId | null {
  const [router, procedure] = path.split(".")
  if (router === "projectVaults") return "projectMemory"
  if (router === "orchestrationOperations" || router === "coordinationEngines") {
    return "orchestration"
  }
  if (router === "savedWorkspaces") return "savedWorkspaces"
  if (router === "automations") return "automations"
  if (router === "planSources" || router === "taskProposals") return "planning"
  if (router === "tasks" && ["board", "moveCard", "archiveCard"].includes(procedure ?? "")) {
    return "planning"
  }
  return null
}

export function betaFeatureForMcpTool(name: string): BetaFeatureId | null {
  if (
    [
      "list_vault_sections",
      "read_vault_section",
      "create_vault_section",
      "update_vault_section",
      "update_vault_handoff",
      "record_vault_decision",
      "list_vault_nodes",
      "read_vault_node",
      "preview_vault_context",
      "create_vault_node",
      "update_vault_node",
      "move_vault_node",
      "link_vault_nodes",
    ].includes(name)
  ) {
    return "projectMemory"
  }
  if (["list_orchestrations", "orchestrate_task"].includes(name)) return "orchestration"
  if (
    [
      "list_automations",
      "read_automation",
      "create_automation_draft",
      "update_automation",
      "enable_automation",
    ].includes(name)
  ) {
    return "automations"
  }
  if (name.includes("task_proposal") || name === "propose_task") {
    return "planning"
  }
  return null
}

export function isMcpToolBetaEnabled(name: string, settings = getBetaFeatureSettings()): boolean {
  const feature = betaFeatureForMcpTool(name)
  return feature ? settings[feature] : true
}

export function isMcpInvocationBetaEnabled(
  name: string,
  input: unknown,
  settings = getBetaFeatureSettings(),
): boolean {
  if (!isMcpToolBetaEnabled(name, settings)) return false
  if (!input || typeof input !== "object") return true
  const value = input as Record<string, unknown>
  if (
    !settings.projectMemory &&
    name === "launch_run" &&
    Array.isArray(value.vaultContextSectionIds) &&
    value.vaultContextSectionIds.length > 0
  ) {
    return false
  }
  return true
}

function getBetaFeatureSettingsPath(): string {
  const overrideDir = process.env.FLAPSTACK_CONFIG_DIR
  if (overrideDir) return join(overrideDir, configFileName)
  return join(getElectronUserDataPath(), "data", configFileName)
}

function ensureSettingsWatcher(): void {
  const path = getBetaFeatureSettingsPath()
  if (watchedPath === path) return
  if (watchedPath) unwatchFile(watchedPath)
  watchedPath = path
  watchFile(path, { interval: 500, persistent: false }, (current, previous) => {
    if (current.mtimeMs === previous.mtimeMs && current.size === previous.size) return
    notifyListeners(getBetaFeatureSettings())
  })
}

function getElectronUserDataPath(): string {
  try {
    const electron = require("electron") as { app?: { getPath(name: string): string } }
    const userDataPath = electron.app?.getPath("userData")
    if (userDataPath) return userDataPath
  } catch {
    // Tests import this helper outside Electron.
  }
  return join(process.cwd(), ".flapstack")
}
