/**
 * Consent-gated hosted analytics for the main process.
 *
 * The main process is the only hosted telemetry boundary. A positive durable
 * marker is required before the SDK module is loaded and before every event.
 */

import { app } from "electron"
import * as fs from "node:fs"
import { mkdir } from "node:fs/promises"
import * as path from "node:path"
import type { ChatMode } from "../../shared/chat-mode"
import { removeFileInsideRoot, writeFileInsideRoot } from "./path-safety"

type PostHogClient = import("posthog-node").PostHog
type PostHogOptions = import("posthog-node").PostHogOptions

const POSTHOG_DESKTOP_KEY =
  import.meta.env.MAIN_VITE_POSTHOG_KEY || "phc_wM7gbrJhOLTvynyhnhPkrVGDc5mKRSXsLGQHqM3T3vq"
const POSTHOG_HOST = import.meta.env.MAIN_VITE_POSTHOG_HOST || "https://us.i.posthog.com"
const FIRST_LAUNCH_MARKER = ".first_launch_tracked"
const ANALYTICS_PREFERENCES_FILE = "analytics-preferences.json"
const ANALYTICS_REVOCATION_FILE = "analytics-consent-revoked"

let posthog: PostHogClient | null = null
let posthogAbortController: AbortController | null = null
let userOptedOut = true
let lifecycleGeneration = 0
let transitionQueue: Promise<void> = Promise.resolve()
let initialization: Promise<void> | null = null
let initializationGeneration: number | null = null

function getUserDataPath(): string {
  try {
    return app.getPath("userData")
  } catch {
    return ""
  }
}

function getAnalyticsPreferencesPath(): string {
  const userDataPath = getUserDataPath()
  return userDataPath ? path.join(userDataPath, ANALYTICS_PREFERENCES_FILE) : ""
}

function getAnalyticsRevocationPath(): string {
  const userDataPath = getUserDataPath()
  return userDataPath ? path.join(userDataPath, ANALYTICS_REVOCATION_FILE) : ""
}

function readDurableAnalyticsConsent(): boolean {
  const preferencesPath = getAnalyticsPreferencesPath()
  const revocationPath = getAnalyticsRevocationPath()
  if (!preferencesPath || !revocationPath) return false

  try {
    // Any object at the revocation path, including a symlink, denies consent.
    fs.lstatSync(revocationPath)
    return false
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || String(error.code) !== "ENOENT") {
      return false
    }
  }

  try {
    const preferencesInfo = fs.lstatSync(preferencesPath)
    if (preferencesInfo.isSymbolicLink() || !preferencesInfo.isFile()) return false
    const stored = JSON.parse(fs.readFileSync(preferencesPath, "utf8")) as {
      consentGranted?: unknown
    }
    return stored.consentGranted === true
  } catch {
    return false
  }
}

/** Missing, malformed, legacy, or explicitly revoked preferences fail closed. */
export function loadAnalyticsConsent(): boolean {
  const consentGranted = readDurableAnalyticsConsent()
  userOptedOut = !consentGranted
  lifecycleGeneration += 1
  return consentGranted
}

async function atomicWrite(relativePath: string, data: string): Promise<void> {
  const userDataPath = getUserDataPath()
  if (!userDataPath) throw new Error("Analytics preferences path is unavailable.")

  await mkdir(userDataPath, { recursive: true })
  await writeFileInsideRoot(
    userDataPath,
    relativePath,
    { data },
    {
      createParents: false,
      overwrite: fs.existsSync(path.join(userDataPath, relativePath)),
    },
  )
}

async function removeDurableFile(relativePath: string): Promise<void> {
  const userDataPath = getUserDataPath()
  if (!userDataPath) throw new Error("Analytics preferences path is unavailable.")
  await removeFileInsideRoot(userDataPath, relativePath)
}

async function persistOptIn(): Promise<void> {
  await atomicWrite(ANALYTICS_PREFERENCES_FILE, JSON.stringify({ consentGranted: true }, null, 2))
  await removeDurableFile(ANALYTICS_REVOCATION_FILE)
}

async function persistOptOut(): Promise<void> {
  // The revocation marker takes precedence over a stale positive preference.
  // If the canonical write fails, restart still remains denied.
  try {
    await atomicWrite(ANALYTICS_REVOCATION_FILE, "revoked\n")
  } catch (revocationError) {
    // If a marker cannot be created, removing the old positive grant is the
    // only safe fallback. Propagate if neither durable denial can be achieved.
    try {
      await removeDurableFile(ANALYTICS_PREFERENCES_FILE)
    } catch {
      throw revocationError
    }
  }

  await atomicWrite(ANALYTICS_PREFERENCES_FILE, JSON.stringify({ consentGranted: false }, null, 2))
}

/**
 * Serialize transitions so delayed writes cannot reorder opt-in and opt-out.
 * Revocation changes runtime state synchronously before any queued work.
 */
export function setOptOut(optedOut: boolean): Promise<void> {
  const requestGeneration = ++lifecycleGeneration
  if (optedOut) {
    userOptedOut = true
    posthogAbortController?.abort()
  }

  const transition = transitionQueue.then(async () => {
    if (optedOut) {
      let transitionError: unknown
      try {
        await persistOptOut()
      } catch (error) {
        transitionError = error
      } finally {
        userOptedOut = true
      }
      try {
        await stopAnalyticsWithoutSending()
      } catch (error) {
        transitionError ??= error
      }
      if (transitionError) throw transitionError
      return
    }

    // Stay disabled until the full positive transition is durable, including
    // removal of any higher-priority revocation marker.
    userOptedOut = true
    await persistOptIn()
    userOptedOut = requestGeneration !== lifecycleGeneration
  })
  transitionQueue = transition.catch(() => undefined)
  return transition
}

export function getAnalyticsConsent(): boolean {
  if (userOptedOut) return false
  if (!readDurableAnalyticsConsent()) {
    userOptedOut = true
    lifecycleGeneration += 1
    void stopAnalyticsWithoutSending().catch(() => undefined)
    return false
  }
  return true
}

// Retained as compatibility no-ops. Account/provider attributes are never
// attached to hosted analytics.
export function setSubscriptionPlan(plan: string): void {
  void plan
}

export function setConnectionMethod(method: string): void {
  void method
}

function isDev(): boolean {
  try {
    return !app.isPackaged && process.env.FORCE_ANALYTICS !== "true"
  } catch {
    return process.env.FORCE_ANALYTICS !== "true"
  }
}

async function initializeAnalytics(generation: number): Promise<void> {
  if (isDev() || posthog || !POSTHOG_DESKTOP_KEY) return
  await transitionQueue
  if (generation !== lifecycleGeneration || userOptedOut || !readDurableAnalyticsConsent()) {
    return
  }

  // Dynamic import is itself behind durable consent. Recheck after the async
  // module load before construction so revocation wins the race.
  const { PostHog } = await import("posthog-node")
  if (generation !== lifecycleGeneration || userOptedOut || !readDurableAnalyticsConsent()) {
    return
  }

  const requestController = new AbortController()
  const options: PostHogOptions = {
    host: POSTHOG_HOST,
    flushAt: 1,
    flushInterval: 0,
    fetchRetryCount: 0,
    preloadFeatureFlags: false,
    disableRemoteFeatureFlags: true,
    disableSurveys: true,
    disableGeoip: true,
    enableExceptionAutocapture: false,
    enableLocalEvaluation: false,
    personProfiles: "never",
    fetch: async (url, request) =>
      fetch(url, {
        ...request,
        signal: requestController.signal,
      }),
  }
  const client = new PostHog(POSTHOG_DESKTOP_KEY, options)

  if (generation !== lifecycleGeneration || userOptedOut || !readDurableAnalyticsConsent()) {
    requestController.abort()
    await client.shutdown()
    return
  }

  posthogAbortController = requestController
  posthog = client
}

export function initAnalytics(): Promise<void> {
  const generation = lifecycleGeneration
  if (initialization && initializationGeneration === generation) return initialization
  const pending = initializeAnalytics(generation).finally(() => {
    if (initialization === pending) {
      initialization = null
      initializationGeneration = null
    }
  })
  initialization = pending
  initializationGeneration = generation
  return pending
}

const ALLOWED_PROPERTIES: Readonly<Record<string, ReadonlySet<string>>> = {
  desktop_opened: new Set(["first_launch"]),
  first_launch: new Set(),
  auth_completed: new Set(),
  project_opened: new Set(["has_git_remote"]),
  workspace_created: new Set(["use_worktree"]),
  workspace_archived: new Set(),
  workspace_deleted: new Set(),
  message_sent: new Set(["mode"]),
  pr_created: new Set(["mode"]),
  commit_created: new Set(["files_changed", "mode"]),
  sub_chat_created: new Set(),
}

const ALLOWED_MODES = new Set(["write", "plan", "read", "review", "agent", "local", "worktree"])

function sanitizeProperties(
  eventName: string,
  properties: Record<string, unknown> | undefined,
): Record<string, string | number | boolean> {
  const result: Record<string, string | number | boolean> = {
    source: "desktop",
    app_version: app.getVersion(),
    platform: process.platform,
  }
  const allowed = ALLOWED_PROPERTIES[eventName]
  if (!allowed || !properties) return result

  for (const key of allowed) {
    const value = properties[key]
    if (key === "mode" && typeof value === "string" && ALLOWED_MODES.has(value)) {
      result[key] = value
    } else if (
      (key === "first_launch" || key === "has_git_remote" || key === "use_worktree") &&
      typeof value === "boolean"
    ) {
      result[key] = value
    } else if (
      key === "files_changed" &&
      typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= 0
    ) {
      result[key] = value
    }
  }
  return result
}

/** Recheck durable authority immediately before every hosted emission. */
export async function capture(
  eventName: string,
  properties?: Record<string, unknown>,
): Promise<void> {
  if (
    isDev() ||
    userOptedOut ||
    !Object.prototype.hasOwnProperty.call(ALLOWED_PROPERTIES, eventName)
  ) {
    return
  }
  const generation = lifecycleGeneration
  await transitionQueue
  if (generation !== lifecycleGeneration || userOptedOut || !readDurableAnalyticsConsent()) {
    userOptedOut = true
    lifecycleGeneration += 1
    void stopAnalyticsWithoutSending().catch(() => undefined)
    return
  }

  const client = posthog
  if (!client) return
  client.capture({
    distinctId: "flapstack-desktop",
    event: eventName,
    properties: sanitizeProperties(eventName, properties),
  })
}

export function identify(userId: string, traits?: Record<string, unknown>): void {
  void userId
  void traits
}

export function getCurrentUserId(): string | null {
  return null
}

export function reset(): void {
  // There is no hosted user identity or cached account metadata to reset.
}

export async function shutdown(): Promise<void> {
  lifecycleGeneration += 1
  const client = posthog
  const requestController = posthogAbortController
  posthog = null
  posthogAbortController = null
  requestController?.abort()
  await client?.shutdown()
}

async function stopAnalyticsWithoutSending(): Promise<void> {
  const client = posthog
  const requestController = posthogAbortController
  posthog = null
  posthogAbortController = null
  requestController?.abort()
  await client?.shutdown()
}

function getFirstLaunchMarkerPath(): string {
  const userDataPath = getUserDataPath()
  return userDataPath ? path.join(userDataPath, FIRST_LAUNCH_MARKER) : ""
}

function isFirstLaunch(): boolean {
  const markerPath = getFirstLaunchMarkerPath()
  if (!markerPath) return false
  try {
    return !fs.existsSync(markerPath)
  } catch {
    return false
  }
}

function markFirstLaunchTracked(): void {
  const markerPath = getFirstLaunchMarkerPath()
  if (!markerPath) return
  try {
    fs.writeFileSync(markerPath, new Date().toISOString())
  } catch {
    // First-launch analytics are optional.
  }
}

export function trackAppOpened(): void {
  const firstLaunch = isFirstLaunch()
  void capture("desktop_opened", { first_launch: firstLaunch })
  if (firstLaunch) {
    markFirstLaunchTracked()
    void capture("first_launch", {
      app_version: app.getVersion(),
      platform: process.platform,
    })
  }
}

export function trackAuthCompleted(userId: string, email?: string): void {
  void userId
  void email
  void capture("auth_completed")
}

export function trackProjectOpened(project: { id: string; hasGitRemote: boolean }): void {
  void project.id
  void capture("project_opened", { has_git_remote: project.hasGitRemote })
}

export function trackWorkspaceCreated(workspace: {
  id: string
  projectId: string | null
  useWorktree: boolean
  repository?: string
}): void {
  void workspace.id
  void workspace.projectId
  void workspace.repository
  void capture("workspace_created", { use_worktree: workspace.useWorktree })
}

export function trackWorkspaceArchived(workspaceId: string): void {
  void workspaceId
  void capture("workspace_archived")
}

export function trackWorkspaceDeleted(workspaceId: string): void {
  void workspaceId
  void capture("workspace_deleted")
}

export function trackMessageSent(data: {
  workspaceId: string
  subChatId?: string
  mode: ChatMode
}): void {
  void data.workspaceId
  void data.subChatId
  void capture("message_sent", { mode: data.mode })
}

export function trackPRCreated(data: {
  workspaceId: string
  prNumber: number
  repository?: string
  mode?: "worktree" | "local"
}): void {
  void data.workspaceId
  void data.prNumber
  void data.repository
  void capture("pr_created", { mode: data.mode })
}

export function trackCommitCreated(data: {
  workspaceId: string
  filesChanged: number
  mode: "worktree" | "local"
}): void {
  void data.workspaceId
  void capture("commit_created", {
    files_changed: data.filesChanged,
    mode: data.mode,
  })
}

export function trackSubChatCreated(data: { workspaceId: string; subChatId: string }): void {
  void data.workspaceId
  void data.subChatId
  void capture("sub_chat_created")
}
