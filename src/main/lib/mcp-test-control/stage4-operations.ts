import { createHash, randomUUID } from "node:crypto"
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { readdir, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, dirname, join } from "node:path"
import { and, eq, or } from "drizzle-orm"
import { app } from "electron"
import { z } from "zod"
import {
  agentRuns,
  chats,
  getDatabase,
  projects,
  projectVaultPolicies,
  projectVaultSections,
  projectVaults,
  subChats,
  tasks,
  taskProposals,
  usageSamples,
} from "../db"
import { assertRegisteredWorktree } from "../git/security/path-validation"
import { getOllamaEndpointConfig } from "../harness/local-model-catalog"
import { sanitizeStage4ControlBoundary, sanitizeStage4ControlError } from "./stage4-boundary"

const callerContext = { getWindow: () => null }
const id = z.string().trim().min(1).max(200)
const payloadSchema = z.record(z.string(), z.unknown()).default({})
const stateDomainSchema = z.enum([
  "skills-hooks",
  "project-vaults",
  "saved-workspaces",
  "automations",
  "local-models",
  "usage-limits",
  "portability",
  "planning",
])
export const STAGE4_OPERATIONAL_ACTIONS = [
  "enable-stage4-beta-fixtures",
  "restore-stage4-beta-fixtures",
  "cleanup-all-owned-fixtures",
  "create-project-skill-fixture",
  "exercise-skills-hooks-fixture",
  "cleanup-project-skill-fixture",
  "create-project-vault-fixture",
  "write-project-vault-fixture",
  "cleanup-project-vault-fixture",
  "create-workspace-fixture",
  "mutate-workspace-fixture",
  "cleanup-workspace-fixture",
  "create-automation-fixture",
  "mutate-automation-fixture",
  "cleanup-automation-fixture",
  "refresh-local-model-fixture",
  "exercise-real-ollama-fixture",
  "create-usage-budget-fixture",
  "cleanup-usage-budget-fixture",
  "start-portability-lifecycle-fixture",
  "get-portability-lifecycle-fixture",
  "cleanup-portability-lifecycle-fixture",
  "create-plan-fixture",
  "exercise-plan-fixture",
  "cleanup-plan-fixture",
] as const
export type Stage4OperationalAction = (typeof STAGE4_OPERATIONAL_ACTIONS)[number]
type OwnedProject = { projectId: string; projectPath: string }
type OwnedSkill = { projectId: string; projectPath: string; relativePath: string }
type OwnedRecord = { projectId: string; recordId: string }

const ownedProjects = new Map<string, OwnedProject>()
const ownedSkills = new Map<string, OwnedSkill>()
const ownedVaults = new Map<string, { projectId: string; rootFingerprint: string }>()
const ownedWorkspaces = new Map<string, OwnedRecord>()
const ownedAutomations = new Map<string, OwnedRecord>()
const ownedBudgets = new Map<string, OwnedRecord>()
const ownedPlans = new Map<string, { projectId: string }>()
type PortabilityLifecycleJob = {
  jobId: string
  projectId: string
  ownerPid: number
  status: "scheduled" | "running" | "completed" | "failed"
  createdAt: string
  updatedAt: string
  result?: Stage4PortabilityLifecycleResult
  error?: string
}
const portabilityLifecycleJobs = new Map<string, PortabilityLifecycleJob>()
const portabilityLifecycleTimers = new Map<string, NodeJS.Timeout>()
const betaFixtureOriginals = new Map<
  "projectMemory" | "savedWorkspaces" | "automations" | "planning",
  boolean
>()
const cleanupFailuresOnce = new Set<
  "skill" | "vault" | "workspace" | "automation" | "budget" | "plan"
>()
let activeRegistryPath: string | null = null

const persistedRegistrySchema = z
  .object({
    version: z.literal(1),
    projects: z.array(
      z.object({ projectId: id, projectPath: z.string().min(1).max(4_096) }).strict(),
    ),
    skills: z.array(
      z
        .object({
          fixtureId: z.string().uuid(),
          projectId: id,
          projectPath: z.string().min(1).max(4_096),
          relativePath: z
            .string()
            .regex(
              /^\.claude\/skills\/stage4-mcp-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/SKILL\.md$/i,
            ),
        })
        .strict(),
    ),
    vaults: z.array(
      z
        .object({
          fixtureId: z.string().uuid(),
          projectId: id,
          rootFingerprint: z
            .string()
            .length(12)
            .regex(/^[a-f0-9]+$/),
        })
        .strict(),
    ),
    workspaces: z.array(
      z.object({ fixtureId: z.string().uuid(), projectId: id, recordId: id }).strict(),
    ),
    automations: z.array(
      z.object({ fixtureId: z.string().uuid(), projectId: id, recordId: id }).strict(),
    ),
    budgets: z.array(
      z.object({ fixtureId: z.string().uuid(), projectId: id, recordId: id }).strict(),
    ),
    plans: z.array(z.object({ fixtureId: z.string().uuid(), projectId: id }).strict()),
    portabilityJobs: z
      .array(
        z
          .object({
            jobId: z.string().uuid(),
            projectId: id,
            ownerPid: z.number().int().positive(),
            status: z.enum(["scheduled", "running", "completed", "failed"]),
            createdAt: z.string().datetime(),
            updatedAt: z.string().datetime(),
            result: z
              .object({
                exported: z.literal(true),
                planned: z.literal(true),
                confirmed: z.literal(true),
                applied: z.literal(true),
                restored: z.literal(true),
                cleaned: z.literal(true),
              })
              .strict()
              .optional(),
            error: z.string().max(2_000).optional(),
          })
          .strict(),
      )
      .max(20)
      .default([]),
    betaOriginals: z.array(
      z
        .object({
          feature: z.enum(["projectMemory", "savedWorkspaces", "automations", "planning"]),
          enabled: z.boolean(),
        })
        .strict(),
    ),
  })
  .strict()

function registryPath(): string {
  return join(app.getPath("userData"), "data", "dev-mcp", "stage4-fixtures.json")
}

function clearOwnershipMemory(): void {
  ownedProjects.clear()
  ownedSkills.clear()
  ownedVaults.clear()
  ownedWorkspaces.clear()
  ownedAutomations.clear()
  ownedBudgets.clear()
  ownedPlans.clear()
  portabilityLifecycleJobs.clear()
  for (const timer of portabilityLifecycleTimers.values()) clearTimeout(timer)
  portabilityLifecycleTimers.clear()
  betaFixtureOriginals.clear()
}

function ensureRegistryHydrated(): void {
  const currentPath = registryPath()
  if (activeRegistryPath === currentPath) return
  clearOwnershipMemory()
  activeRegistryPath = currentPath
  if (!existsSync(currentPath)) return
  let stored: z.infer<typeof persistedRegistrySchema>
  try {
    stored = persistedRegistrySchema.parse(JSON.parse(readFileSync(currentPath, "utf8")))
  } catch {
    throw new Error("The persisted Stage 4 fixture registry is invalid")
  }
  for (const project of stored.projects) ownedProjects.set(project.projectId, project)
  for (const { fixtureId: ownedId, ...fixture } of stored.skills) {
    ownedSkills.set(ownedId, fixture)
  }
  for (const { fixtureId: ownedId, ...fixture } of stored.vaults) {
    ownedVaults.set(ownedId, fixture)
  }
  for (const { fixtureId: ownedId, ...fixture } of stored.workspaces) {
    ownedWorkspaces.set(ownedId, fixture)
  }
  for (const { fixtureId: ownedId, ...fixture } of stored.automations) {
    ownedAutomations.set(ownedId, fixture)
  }
  for (const { fixtureId: ownedId, ...fixture } of stored.budgets) {
    ownedBudgets.set(ownedId, fixture)
  }
  for (const { fixtureId: ownedId, ...fixture } of stored.plans) {
    ownedPlans.set(ownedId, fixture)
  }
  let recoveredInterruptedJob = false
  for (const storedJob of stored.portabilityJobs) {
    const job = { ...storedJob }
    if (job.ownerPid !== process.pid && (job.status === "scheduled" || job.status === "running")) {
      job.status = "failed"
      job.error = "Portability lifecycle was interrupted by an app restart."
      job.updatedAt = new Date().toISOString()
      recoveredInterruptedJob = true
    }
    portabilityLifecycleJobs.set(job.jobId, job)
  }
  for (const original of stored.betaOriginals) {
    betaFixtureOriginals.set(original.feature, original.enabled)
  }
  if (recoveredInterruptedJob) persistRegistry()
}

function persistRegistry(): void {
  if (!activeRegistryPath) throw new Error("Stage 4 fixture registry was not initialized")
  const persisted = persistedRegistrySchema.parse({
    version: 1,
    projects: [...ownedProjects.values()],
    skills: [...ownedSkills].map(([ownedId, fixture]) => ({
      fixtureId: ownedId,
      ...fixture,
    })),
    vaults: [...ownedVaults].map(([ownedId, fixture]) => ({
      fixtureId: ownedId,
      ...fixture,
    })),
    workspaces: [...ownedWorkspaces].map(([ownedId, fixture]) => ({
      fixtureId: ownedId,
      ...fixture,
    })),
    automations: [...ownedAutomations].map(([ownedId, fixture]) => ({
      fixtureId: ownedId,
      ...fixture,
    })),
    budgets: [...ownedBudgets].map(([ownedId, fixture]) => ({
      fixtureId: ownedId,
      ...fixture,
    })),
    plans: [...ownedPlans].map(([ownedId, fixture]) => ({
      fixtureId: ownedId,
      ...fixture,
    })),
    portabilityJobs: [...portabilityLifecycleJobs.values()],
    betaOriginals: [...betaFixtureOriginals].map(([feature, enabled]) => ({
      feature,
      enabled,
    })),
  })
  writeStage4RegistryAtomically(activeRegistryPath, `${JSON.stringify(persisted, null, 2)}\n`)
}

export function writeStage4RegistryAtomically(
  targetPath: string,
  contents: string,
  operations: {
    rename?: typeof renameSync
  } = {},
): void {
  const directory = dirname(targetPath)
  mkdirSync(directory, { recursive: true })
  const temporaryPath = join(
    directory,
    `.${basename(targetPath)}.${process.pid}.${randomUUID()}.tmp`,
  )
  try {
    writeFileSync(temporaryPath, contents, {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    })
    ;(operations.rename ?? renameSync)(temporaryPath, targetPath)
  } finally {
    if (existsSync(temporaryPath)) rmSync(temporaryPath, { force: true })
  }
}

export type Stage4OperationalStateInput = {
  domain: z.infer<typeof stateDomainSchema>
  projectId?: string
}

export type Stage4OperationalMutationInput = {
  action: Stage4OperationalAction
  payload?: Record<string, unknown>
}

export function validateRealOllamaFixtureInput(
  inputValue: unknown,
  environment: Record<string, string | undefined> = process.env,
) {
  if (environment.FLAPSTACK_STAGE4_REAL_OLLAMA !== "1") {
    throw new Error("Real Ollama verification requires FLAPSTACK_STAGE4_REAL_OLLAMA=1")
  }
  const input = z
    .object({
      projectId: id,
      endpoint: z.string().trim().min(1).max(512),
      model: z.string().trim().min(1).max(200),
    })
    .strict()
    .parse(inputValue)
  const endpoint = getOllamaEndpointConfig({ baseUrl: input.endpoint })
  return { ...input, endpoint: endpoint.baseUrl }
}

type CallableRouter = Record<string, (input?: unknown) => unknown>

function procedure(router: { createCaller(context: typeof callerContext): unknown }, name: string) {
  const caller = router.createCaller(callerContext) as CallableRouter
  const selected = caller[name]
  if (typeof selected !== "function") throw new Error(`Unsupported production procedure: ${name}`)
  return (input?: unknown) => Promise.resolve(selected(input))
}

async function collectStage4Observable(value: unknown, timeoutMs = 180_000): Promise<unknown[]> {
  const stream = value as {
    subscribe(observer: {
      next(value: unknown): void
      error(error: unknown): void
      complete(): void
    }): { unsubscribe(): void }
  }
  if (!stream || typeof stream.subscribe !== "function") {
    throw new Error("Production local-model chat returned no observable stream")
  }
  const chunks: unknown[] = []
  await new Promise<void>((resolvePromise, rejectPromise) => {
    let subscription: { unsubscribe(): void } | undefined
    const timer = setTimeout(() => {
      subscription?.unsubscribe()
      rejectPromise(new Error("Real Ollama verification exceeded 180 seconds"))
    }, timeoutMs)
    subscription = stream.subscribe({
      next: (chunk) => chunks.push(chunk),
      error: (error) => {
        clearTimeout(timer)
        rejectPromise(error)
      },
      complete: () => {
        clearTimeout(timer)
        resolvePromise()
      },
    })
  })
  return chunks
}

function fingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12)
}

function pathHint(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null
  const leaf = basename(value.replaceAll("\\", "/"))
  const extension = leaf.match(/\.([A-Za-z0-9]{1,10})$/)?.[1]?.toLowerCase()
  return `[path:${extension ? `file.${extension}` : "directory"}:${fingerprint(value)}]`
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export function extractRealOllamaPersistedMetadata(messagesValue: unknown, runId: string) {
  const assistant = Array.isArray(messagesValue)
    ? messagesValue
        .map(record)
        .find((message) => message.role === "assistant" && record(message.metadata).runId === runId)
    : undefined
  const localModel = record(record(assistant?.metadata).localModel)
  return {
    harness: stringField(localModel.harness),
    modelId: stringField(record(localModel.model).modelId),
    fallback: record(localModel.fallback),
  }
}

export function summarizeRealOllamaUsageEvidence(value: unknown) {
  const usage = record(value)
  return {
    providerId: stringField(usage.providerId),
    model: stringField(usage.model),
    inputUsageRecorded: (numberField(usage.inputTokens) ?? 0) > 0,
    outputUsageRecorded: (numberField(usage.outputTokens) ?? 0) > 0,
    totalUsageRecorded: (numberField(usage.totalTokens) ?? 0) > 0,
    costUsd: numberField(usage.costUsd),
    costQuality: stringField(usage.costQuality),
  }
}

function stringField(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

function numberField(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function booleanField(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null
}

export function redactStage4Skill(value: unknown) {
  const item = record(value)
  return {
    name: stringField(item.name),
    description: stringField(item.description) ?? "",
    source: stringField(item.source),
    pluginName: stringField(item.pluginName),
    pathHint: pathHint(item.path),
  }
}

export function redactStage4Automation(value: unknown) {
  const item = record(value)
  const draft = record(item.draft)
  const approval = record(item.approval)
  const scope = record(draft.scope ?? item.scope)
  const action = record(draft.action ?? item.action)
  const trigger = record(draft.trigger ?? item.trigger)
  const run = record(draft.run ?? item.run)
  return {
    id: stringField(item.id),
    name: stringField(item.name ?? draft.name),
    state: stringField(item.state),
    approvalState: stringField(item.approvalState ?? approval.state),
    enabled: booleanField(item.enabled),
    version: numberField(item.version),
    scopeType: stringField(scope.type),
    actionType: stringField(action.type),
    triggerType: stringField(trigger.type),
    harness: stringField(run.harness),
  }
}

export function redactStage4Workspace(value: unknown) {
  const item = record(value)
  const owner = record(item.owner)
  const scope = record(item.scope)
  const layout = record(item.layout)
  const pending = [record(layout.root)]
  const bindingTypes = new Set<string>()
  let paneCount = 0
  while (pending.length > 0) {
    const node = pending.pop()!
    if (node.type === "split" && Array.isArray(node.children)) {
      pending.push(...node.children.map(record))
    }
    if (node.type === "tabs" && Array.isArray(node.panes)) {
      for (const paneValue of node.panes) {
        const bindingType = stringField(record(record(paneValue).binding).type)
        paneCount += 1
        if (bindingType) bindingTypes.add(bindingType)
      }
    }
  }
  return {
    id: stringField(item.id),
    name: stringField(item.name),
    version: numberField(item.version),
    ownerKind: stringField(owner.kind ?? item.ownerKind),
    scopeType: stringField(scope.type ?? item.scopeType),
    archived: item.archivedAt !== null && item.archivedAt !== undefined,
    paneCount,
    bindingTypes: [...bindingTypes].sort(),
    rosterCount: Array.isArray(item.roster) ? item.roster.length : 0,
  }
}

function summarizeStage4HookInventory(value: unknown) {
  const items = Array.isArray(value) ? value.map(record) : []
  const byState: Record<string, number> = {}
  const byHarness: Record<string, number> = {}
  for (const item of items) {
    const state = stringField(item.state) ?? "unknown"
    const harness = stringField(record(item.definition).harness) ?? "unknown"
    byState[state] = (byState[state] ?? 0) + 1
    byHarness[harness] = (byHarness[harness] ?? 0) + 1
  }
  return {
    count: items.length,
    byState,
    byHarness,
    dryRunReady: items.filter((item) => Boolean(record(item.dryRun).success)).length,
    enabled: items.filter((item) => item.enabled === true).length,
  }
}

function summarizeStage4AutomationPreview(value: unknown) {
  const item = record(value)
  const target = record(item.target)
  const authority = record(item.authoritySnapshot)
  return {
    harness: stringField(item.harness),
    scopeType: stringField(target.scopeType),
    permissionMode: stringField(authority.permissionMode),
    launchable: booleanField(item.launchable),
    blocker: stringField(item.launchBlocker),
  }
}

function summarizeStage4AutomationRecord(value: unknown, blocker: string) {
  const draft = record(record(value).draft)
  const run = record(draft.run)
  const scope = record(draft.scope)
  return {
    harness: stringField(run.harness),
    scopeType: stringField(scope.type),
    permissionMode: stringField(run.permissionMode),
    launchable: false,
    blocker,
  }
}

export function redactStage4VaultPolicy(value: unknown) {
  const item = record(value)
  const rootPath = stringField(item.rootPath ?? item.vaultPath)
  return {
    projectId: stringField(item.projectId),
    locationMode: stringField(item.locationMode),
    schemaVersion: numberField(item.schemaVersion),
    gitTrackingEnabled: booleanField(item.gitTrackingEnabled),
    rootPathHint: pathHint(rootPath),
    rootFingerprint: rootPath ? fingerprint(rootPath) : null,
  }
}

export function redactStage4PrivateSync(value: unknown) {
  if (!value) return { linked: false }
  const item = record(value)
  const repoPath = stringField(item.repoPath)
  const remote = stringField(item.remote)
  return {
    linked: true,
    branch: stringField(item.branch),
    scopes: Array.isArray(item.scopes)
      ? item.scopes.filter((scope): scope is string => typeof scope === "string")
      : [],
    repoPathHint: pathHint(repoPath),
    repoPathFingerprint: repoPath ? fingerprint(repoPath) : null,
    remoteConfigured: Boolean(remote),
    remoteFingerprint: remote ? fingerprint(remote) : null,
  }
}

export function redactStage4UsageBudget(value: unknown) {
  const item = record(value)
  const scope = record(item.scope)
  const accountTag = stringField(scope.accountTag)
  return {
    id: stringField(item.id),
    name: stringField(item.name),
    enabled: booleanField(item.enabled),
    scope: {
      type: stringField(scope.type),
      providerId: stringField(scope.providerId),
      projectId: stringField(scope.projectId),
      taskId: stringField(scope.taskId),
      automationId: stringField(scope.automationId),
      orchestrationId: stringField(scope.orchestrationId),
      accountTagFingerprint: accountTag ? fingerprint(accountTag) : null,
    },
    threshold: redactStage4Value(item.threshold),
    action: stringField(item.action),
    reset: redactStage4Value(item.reset),
    version: numberField(item.version),
  }
}

export function redactStage4Value(value: unknown, key = ""): unknown {
  if (Array.isArray(value)) return value.map((item) => redactStage4Value(item, key))
  if (!value || typeof value !== "object") {
    if (typeof value !== "string") return value
    const lower = key.toLowerCase()
    if (/(secret|password|token|prompt|content|description)/.test(lower)) return "[redacted]"
    if (/(path|root|cwd|directory)/.test(lower)) {
      return { hint: pathHint(value), fingerprint: fingerprint(value) }
    }
    if (/accounttag/.test(lower)) return fingerprint(value)
    if (/remote|url/.test(lower)) {
      try {
        const parsed = new URL(value)
        return { host: parsed.hostname, fingerprint: fingerprint(value) }
      } catch {
        return { fingerprint: fingerprint(value) }
      }
    }
    return value
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
      entryKey,
      redactStage4Value(entryValue, entryKey),
    ]),
  )
}

async function getStage4OperationalStateUnsafe(inputValue: Stage4OperationalStateInput) {
  ensureRegistryHydrated()
  const input = z
    .object({
      domain: stateDomainSchema,
      projectId: id.optional(),
    })
    .strict()
    .parse(inputValue)
  const { getBetaFeatureSettings } = await import("../beta-features/settings")
  const beta = getBetaFeatureSettings()

  if (input.domain === "skills-hooks") {
    if (!input.projectId) throw new Error("projectId is required for skills-hooks state")
    const project = requireOwnedProject(input.projectId)
    const [{ hooksManagementRouter }, { skillsRouter }] = await Promise.all([
      import("../trpc/routers/hooks-management"),
      import("../trpc/routers/skills"),
    ])
    const [capabilities, hookInventory, listedSkills] = await Promise.all([
      procedure(hooksManagementRouter, "getCapabilities")(),
      procedure(hooksManagementRouter, "listInventory")(),
      procedure(skillsRouter, "list")({ cwd: project.projectPath }),
    ])
    const ownedNames = new Set(
      [...ownedSkills]
        .filter(([, fixture]) => fixture.projectId === project.projectId)
        .map(([ownedId]) => `stage4-mcp-${ownedId}`),
    )
    const skills = (Array.isArray(listedSkills) ? listedSkills : []).filter((skill) =>
      ownedNames.has(stringField(record(skill).name) ?? ""),
    )
    return {
      domain: input.domain,
      skills: skills.map(redactStage4Skill),
      hookInventory: summarizeStage4HookInventory(hookInventory),
      capabilities: redactStage4Value(capabilities),
    }
  }

  if (input.domain === "project-vaults") {
    if (!input.projectId) throw new Error("projectId is required for project-vaults state")
    requireOwnedProject(input.projectId)
    if (!beta.projectMemory) {
      return { domain: input.domain, enabled: false, projectId: input.projectId }
    }
    const database = getDatabase()
    const policy = database
      .select()
      .from(projectVaultPolicies)
      .where(eq(projectVaultPolicies.projectId, input.projectId))
      .get()
    const vault = database
      .select()
      .from(projectVaults)
      .where(eq(projectVaults.projectId, input.projectId))
      .get()
    const sections = vault
      ? database
          .select()
          .from(projectVaultSections)
          .where(eq(projectVaultSections.projectId, input.projectId))
          .all()
      : []
    const backups = vault
      ? Object.fromEntries(
          await Promise.all(
            sections.map(async (section) => {
              const { projectVaultsRouter } = await import("../trpc/routers/project-vaults")
              const items = await procedure(
                projectVaultsRouter,
                "listBackups",
              )({
                projectId: input.projectId,
                sectionId: section.sectionId,
              })
              return [section.sectionId, Array.isArray(items) ? items.length : 0] as const
            }),
          ),
        )
      : {}
    return {
      domain: input.domain,
      enabled: true,
      fixtureOwned: [...ownedVaults.values()].some(
        (fixture) => fixture.projectId === input.projectId,
      ),
      policy: policy
        ? redactStage4VaultPolicy({
            ...policy,
            rootPath: vault?.rootPath ?? policy.centralPath,
            schemaVersion: vault?.schemaVersion ?? null,
          })
        : null,
      sections: sections.map((section) => ({
        sectionId: section.sectionId,
        version: section.version,
        contentHash: section.contentHash,
        updatedAt: section.updatedAt?.toISOString() ?? null,
      })),
      backupCounts: backups,
    }
  }

  if (input.domain === "saved-workspaces") {
    if (!input.projectId) throw new Error("projectId is required for saved-workspaces state")
    requireOwnedProject(input.projectId)
    if (!beta.savedWorkspaces) return { domain: input.domain, enabled: false, workspaces: [] }
    const { savedWorkspacesRouter } = await import("../trpc/routers/saved-workspaces")
    const items = await Promise.all(
      [...ownedWorkspaces]
        .filter(([, fixture]) => fixture.projectId === input.projectId)
        .map(async ([ownedId, fixture]) => {
          const item = await procedure(
            savedWorkspacesRouter,
            "get",
          )({
            workspaceId: fixture.recordId,
          }).catch(() => null)
          if (item) assertWorkspaceFixtureRecord(item, ownedId)
          return item
        }),
    )
    return {
      domain: input.domain,
      enabled: true,
      workspaces: items.filter(Boolean).map(redactStage4Workspace),
    }
  }

  if (input.domain === "automations") {
    if (!input.projectId) throw new Error("projectId is required for automations state")
    requireOwnedProject(input.projectId)
    if (!beta.automations) return { domain: input.domain, enabled: false, automations: [] }
    const { automationsRouter } = await import("../trpc/routers/automations")
    const capabilities = await procedure(automationsRouter, "getCapabilities")()
    const items = await Promise.all(
      [...ownedAutomations]
        .filter(([, fixture]) => fixture.projectId === input.projectId)
        .map(async ([ownedId, fixture]) => {
          const item = await procedure(
            automationsRouter,
            "get",
          )({
            automationId: fixture.recordId,
          }).catch(() => null)
          if (!item) return null
          assertAutomationFixtureRecord(item, ownedId)
          const preview = await procedure(
            automationsRouter,
            "dryRun",
          )({
            automationId: fixture.recordId,
          }).catch(() => summarizeStage4AutomationRecord(item, "dry-run-unavailable-current-state"))
          return {
            ...record(item),
            dryRun:
              record(preview).launchable === false && "permissionMode" in record(preview)
                ? preview
                : summarizeStage4AutomationPreview(preview),
          }
        }),
    )
    return {
      domain: input.domain,
      enabled: true,
      capabilities: redactStage4Value(capabilities),
      automations: items.filter(Boolean).map((item) => ({
        ...redactStage4Automation(item),
        dryRun: record(record(item).dryRun),
      })),
    }
  }

  if (input.domain === "local-models") {
    const { createLocalModelDevFixtureCatalog, isLocalModelDevFixtureEnabled } =
      await import("../harness/local-model-dev-fixture")
    if (
      !isLocalModelDevFixtureEnabled({
        isPackaged: app.isPackaged,
        rendererUrl: process.env.ELECTRON_RENDERER_URL,
      })
    ) {
      throw new Error("Local-model fixtures require an unpackaged Dev instance")
    }
    const endpoint = "http://127.0.0.1:43127"
    const catalog = createLocalModelDevFixtureCatalog(endpoint)
    if (!catalog) throw new Error("Local-model fixture catalog is unavailable")
    return {
      domain: input.domain,
      diagnostics: {
        provider: "ollama",
        endpointPolicy: "deterministic-dev-fixture",
        catalogState: catalog.state,
        catalogModelCount: catalog.models.length,
      },
      catalog: redactStage4Value(catalog),
    }
  }

  if (input.domain === "usage-limits") {
    if (!input.projectId) throw new Error("projectId is required for usage-limits state")
    requireOwnedProject(input.projectId)
    const { usageRouter } = await import("../trpc/routers/usage")
    const budgets = await Promise.all(
      [...ownedBudgets]
        .filter(([, fixture]) => fixture.projectId === input.projectId)
        .map(async ([ownedId, fixture]) => {
          const item = await procedure(usageRouter, "getBudget")({ id: fixture.recordId })
          if (item) assertBudgetFixtureRecord(item, ownedId)
          return item
        }),
    )
    const rollupValue = record(
      await procedure(
        usageRouter,
        "queryRollups",
      )({
        scope: { type: "project", id: input.projectId },
        providerIds: ["openrouter"],
        bucket: "none",
        groupBy: "none",
        timezone: "UTC",
        limit: 100,
      }),
    )
    const insightValue = record(
      await procedure(
        usageRouter,
        "queryInsights",
      )({
        rollup: {
          scope: { type: "project", id: input.projectId },
          providerIds: ["openrouter"],
          bucket: "none",
          groupBy: "none",
          timezone: "UTC",
          limit: 100,
        },
        metric: "total-tokens",
      }),
    )
    return {
      domain: input.domain,
      budgets: budgets.filter(Boolean).map(redactStage4UsageBudget),
      rollup: {
        itemCount: Array.isArray(rollupValue.items) ? rollupValue.items.length : 0,
        quality: stringField(record(rollupValue.totals).quality),
      },
      insight: {
        coverage: stringField(record(insightValue.coverage).status),
        quality: stringField(record(insightValue.burnRate).quality),
      },
    }
  }

  if (input.domain === "portability") {
    const [{ importExportRouter }, { getPortabilityOperationState }] = await Promise.all([
      import("../trpc/routers/import-export"),
      import("../portability/operations"),
    ])
    const capabilities = await procedure(importExportRouter, "getCapabilities")()
    const privateSync = await procedure(importExportRouter, "getPrivateSync")()
    return {
      domain: input.domain,
      capabilities: redactStage4Value(capabilities),
      operation: getPortabilityOperationState(),
      privateSync: redactStage4PrivateSync(privateSync),
    }
  }

  if (!input.projectId) throw new Error("projectId is required for planning state")
  requireOwnedProject(input.projectId)
  if (!beta.planning) {
    return { domain: input.domain, enabled: false, projectId: input.projectId, proposals: [] }
  }
  const ownedPlan = [...ownedPlans.values()].some(
    (fixture) => fixture.projectId === input.projectId,
  )
  if (!ownedPlan) {
    return {
      domain: input.domain,
      enabled: true,
      fixture: { state: "not-owned" },
      proposalCount: 0,
      proposals: [],
      registrationCount: 0,
    }
  }
  const [{ planSourcesRouter }, { IS_DEV }] = await Promise.all([
    import("../trpc/routers/plan-sources"),
    import("../../constants"),
  ])
  const proposals = getDatabase()
    .select()
    .from(taskProposals)
    .where(
      and(
        eq(taskProposals.projectId, input.projectId),
        or(
          eq(taskProposals.sourcePath, ".flapstack/dev-fixtures/plan-kanban/plan.md"),
          eq(
            taskProposals.sourcePath,
            "openspec/changes/flapstack-dev-plan-kanban-fixture/tasks.md",
          ),
        ),
      ),
    )
    .all()
  const fixture =
    IS_DEV && !app.isPackaged
      ? await procedure(planSourcesRouter, "devFixtureStatus")({ projectId: input.projectId })
      : {
          state: "unavailable",
          message: "Plan fixture mutation is available only in an unpackaged Dev instance.",
        }
  return {
    domain: input.domain,
    enabled: true,
    fixture: redactStage4Value(fixture),
    proposalCount: proposals.length,
    proposals: proposals.map((proposal) => {
      return {
        id: proposal.id,
        projectId: proposal.projectId,
        status: proposal.status,
        targetStatus: proposal.targetStatus,
        version: proposal.version,
        sourceType: proposal.sourceType,
      }
    }),
    registrationCount: 1,
  }
}

export async function getStage4OperationalState(inputValue: Stage4OperationalStateInput) {
  return sanitizeStage4ControlBoundary(await getStage4OperationalStateUnsafe(inputValue))
}

export async function mutateStage4OperationalState(inputValue: Stage4OperationalMutationInput) {
  ensureRegistryHydrated()
  const input = z
    .object({ action: z.enum(STAGE4_OPERATIONAL_ACTIONS), payload: payloadSchema.optional() })
    .strict()
    .parse(inputValue)
  const payload = input.payload ?? {}
  const output = await runStage4Mutation(input.action, payload)
  return {
    action: input.action,
    result: sanitizeStage4ControlBoundary(redactStage4Value(output)),
  }
}

export function registerStage4TestProject(input: { projectId: string; projectPath: string }): void {
  ensureRegistryHydrated()
  const projectPath = realpathSync(input.projectPath)
  ownedProjects.set(input.projectId, { projectId: input.projectId, projectPath })
  persistRegistry()
}

export function redactStage4ErrorMessage(error: unknown): string {
  return sanitizeStage4ControlError(error).message
}

function requireOwnedProject(projectId: string): OwnedProject {
  ensureRegistryHydrated()
  const owned = ownedProjects.get(projectId)
  if (!owned) throw new Error("Mutation requires an owned test project")
  const project = getDatabase()
    .select({ id: projects.id, path: projects.path })
    .from(projects)
    .where(eq(projects.id, projectId))
    .get()
  if (!project || realpathSync(project.path) !== owned.projectPath) {
    throw new Error("Owned test project identity is stale")
  }
  const registered = assertRegisteredWorktree(project.path)
  if (registered.canonicalPath !== owned.projectPath) {
    throw new Error("Owned test project filesystem identity changed")
  }
  return owned
}

function maybeFailCleanupForTests(
  kind: "skill" | "vault" | "workspace" | "automation" | "budget" | "plan",
): void {
  if (!cleanupFailuresOnce.delete(kind)) return
  throw new Error(`Injected ${kind} fixture cleanup failure`)
}

export function failNextStage4CleanupForTests(
  kind: "skill" | "vault" | "workspace" | "automation" | "budget" | "plan",
): void {
  cleanupFailuresOnce.add(kind)
}

export function resetStage4OperationalMemoryForTests(): void {
  clearOwnershipMemory()
  activeRegistryPath = null
}

export function getStage4OperationalRegistryForTests(): {
  projectIds: string[]
  fixtureCount: number
} {
  ensureRegistryHydrated()
  return {
    projectIds: [...ownedProjects.keys()].sort(),
    fixtureCount:
      ownedSkills.size +
      ownedVaults.size +
      ownedWorkspaces.size +
      ownedAutomations.size +
      ownedBudgets.size +
      ownedPlans.size +
      portabilityLifecycleJobs.size,
  }
}

function fixtureId(payload: Record<string, unknown>): string {
  return z.object({ fixtureId: z.string().uuid() }).strict().parse(payload).fixtureId
}

function requireOwnedFixture<T>(items: Map<string, T>, idValue: string, label: string): T {
  const item = items.get(idValue)
  if (!item) throw new Error(`Mutation requires an owned ${label} fixture`)
  return item
}

function workspaceFixtureName(ownedId: string, renamed = false): string {
  return `Stage 4 MCP ${renamed ? "renamed" : "fixture"} ${ownedId}`
}

function assertWorkspaceFixtureRecord(value: unknown, ownedId: string): void {
  const name = stringField(record(value).name)
  if (name !== workspaceFixtureName(ownedId) && name !== workspaceFixtureName(ownedId, true)) {
    throw new Error("Owned workspace fixture metadata does not match its registry identity")
  }
}

function assertAutomationFixtureRecord(value: unknown, ownedId: string): void {
  if (stringField(record(record(value).draft).name) !== `Stage 4 MCP fixture ${ownedId}`) {
    throw new Error("Owned automation fixture metadata does not match its registry identity")
  }
}

function assertBudgetFixtureRecord(value: unknown, ownedId: string): void {
  if (stringField(record(value).name) !== `Stage 4 MCP fixture ${ownedId}`) {
    throw new Error("Owned usage budget fixture metadata does not match its registry identity")
  }
}

function skillFixtureRelativePath(ownedId: string): string {
  return `.claude/skills/stage4-mcp-${ownedId}/SKILL.md`
}

function skillFixtureContent(ownedId: string): string {
  return `---
name: stage4-mcp-${ownedId}
description: Bounded Stage 4 MCP fixture.
---

Production skill persistence proof. No external actions.`
}

function assertSkillFixtureRecord(ownedId: string, fixture: OwnedSkill): void {
  if (fixture.relativePath !== skillFixtureRelativePath(ownedId)) {
    throw new Error("Owned skill fixture path does not match its registry identity")
  }
  const absolutePath = join(fixture.projectPath, fixture.relativePath)
  const directory = lstatSync(dirname(absolutePath))
  const file = lstatSync(absolutePath)
  if (
    directory.isSymbolicLink() ||
    !directory.isDirectory() ||
    file.isSymbolicLink() ||
    !file.isFile() ||
    readFileSync(absolutePath, "utf8") !== skillFixtureContent(ownedId)
  ) {
    throw new Error("Owned skill fixture metadata does not match its registry identity")
  }
}

async function cleanupPortabilityFixtureState(
  stateRoot: string,
  planId: string | null,
  operationId: string | null,
): Promise<void> {
  if (planId) await rm(join(stateRoot, "plans", `${planId}.json`), { force: true })
  const operationIds = new Set(operationId ? [operationId] : [])
  if (planId) {
    const journalRoot = join(stateRoot, "journals")
    for (const name of await readdir(journalRoot).catch(() => [])) {
      const journalId = name.endsWith(".json") ? name.slice(0, -5) : ""
      if (!z.string().uuid().safeParse(journalId).success) continue
      try {
        const journal = JSON.parse(await readFile(join(journalRoot, name), "utf8")) as {
          operationId?: unknown
          planId?: unknown
        }
        if (
          journal.planId === planId &&
          typeof journal.operationId === "string" &&
          z.string().uuid().safeParse(journal.operationId).success
        ) {
          operationIds.add(journal.operationId)
        }
      } catch {
        // Unrelated or incomplete journal state is preserved.
      }
    }
  }
  for (const ownedOperationId of operationIds) {
    await rm(join(stateRoot, "operations", ownedOperationId), {
      recursive: true,
      force: true,
    })
    await rm(join(stateRoot, "journals", `${ownedOperationId}.json`), { force: true })
  }
}

type CleanupFixtureKind = "skills" | "vaults" | "workspaces" | "automations" | "budgets" | "plans"

function emptyCleanupCounts(): Record<CleanupFixtureKind, number> {
  return {
    skills: 0,
    vaults: 0,
    workspaces: 0,
    automations: 0,
    budgets: 0,
    plans: 0,
  }
}

async function cleanupAllOwnedFixtures() {
  const cleaned = emptyCleanupCounts()
  const retryRequired = emptyCleanupCounts()
  const jobs: Array<{
    kind: CleanupFixtureKind
    action: Stage4OperationalAction
    fixtureIds: string[]
  }> = [
    {
      kind: "plans",
      action: "cleanup-plan-fixture",
      fixtureIds: [...ownedPlans.keys()],
    },
    {
      kind: "budgets",
      action: "cleanup-usage-budget-fixture",
      fixtureIds: [...ownedBudgets.keys()],
    },
    {
      kind: "automations",
      action: "cleanup-automation-fixture",
      fixtureIds: [...ownedAutomations.keys()],
    },
    {
      kind: "workspaces",
      action: "cleanup-workspace-fixture",
      fixtureIds: [...ownedWorkspaces.keys()],
    },
    {
      kind: "vaults",
      action: "cleanup-project-vault-fixture",
      fixtureIds: [...ownedVaults.keys()],
    },
    {
      kind: "skills",
      action: "cleanup-project-skill-fixture",
      fixtureIds: [...ownedSkills.keys()],
    },
  ]

  for (const job of jobs) {
    for (const ownedId of job.fixtureIds) {
      try {
        const result = record(
          await runStage4Mutation(job.action, {
            fixtureId: ownedId,
          }),
        )
        if (result.cleaned === true) cleaned[job.kind] += 1
        else retryRequired[job.kind] += 1
      } catch {
        retryRequired[job.kind] += 1
      }
    }
  }

  let betaFlags: "not-needed" | "restored" | "retry-required" = "not-needed"
  if (betaFixtureOriginals.size > 0) {
    try {
      await runStage4Mutation("restore-stage4-beta-fixtures", {})
      betaFlags = "restored"
    } catch {
      betaFlags = "retry-required"
    }
  }

  const hasRemainingFixtures =
    ownedPlans.size > 0 ||
    ownedBudgets.size > 0 ||
    ownedAutomations.size > 0 ||
    ownedWorkspaces.size > 0 ||
    ownedVaults.size > 0 ||
    ownedSkills.size > 0
  if (!hasRemainingFixtures && betaFixtureOriginals.size === 0) ownedProjects.clear()
  persistRegistry()

  const retryCount =
    Object.values(retryRequired).reduce((total, count) => total + count, 0) +
    (betaFlags === "retry-required" ? 1 : 0)
  return {
    status: retryCount === 0 ? "clean" : "retry-required",
    cleaned,
    retryRequired,
    betaFlags,
  }
}

type Stage4PortabilityLifecycleResult = {
  exported: true
  planned: true
  confirmed: true
  applied: true
  restored: true
  cleaned: true
}

export async function runStage4PortabilityFixtureForTests(
  projectId: string,
): Promise<Stage4PortabilityLifecycleResult> {
  requireOwnedProject(projectId)
  const { app } = await import("electron")
  const { importExportRouter } = await import("../trpc/routers/import-export")
  const root = mkdtempSync(join(app.getPath("temp") || tmpdir(), "flapstack-stage4-portability-"))
  const bundlePath = join(root, "fixture.flapstack-export")
  const stateRoot = join(app.getPath("userData"), "data", "portability")
  let planId: string | null = null
  let operationId: string | null = null
  try {
    await procedure(
      importExportRouter,
      "createExport",
    )({
      operationId: randomUUID(),
      outputPath: bundlePath,
      scopes: [{ id: "projects", projectIds: [projectId] }],
    })
    const plan = record(await procedure(importExportRouter, "dryRunImport")({ bundlePath }))
    planId = stringField(plan.id)
    const expectedFingerprint = stringField(plan.bundleFingerprint)
    if (!planId || !expectedFingerprint) {
      throw new Error("Portability fixture plan is incomplete")
    }
    const resolutions = Object.fromEntries(
      [
        ...(Array.isArray(plan.database) ? plan.database : []),
        ...(Array.isArray(plan.files) ? plan.files : []),
      ]
        .map(record)
        .filter((item) => item.kind === "conflict" && typeof item.id === "string")
        .map((item) => [String(item.id), "use-incoming"]),
    )
    const confirmation = record(
      await procedure(
        importExportRouter,
        "prepareImportConfirmation",
      )({
        planId,
        ...(Object.keys(resolutions).length ? { resolutions } : {}),
      }),
    )
    const expectedConfirmationHash = stringField(confirmation.confirmationHash)
    if (!expectedConfirmationHash) {
      throw new Error("Portability fixture confirmation is incomplete")
    }
    const applied = record(
      await procedure(
        importExportRouter,
        "applyImport",
      )({
        planId,
        expectedFingerprint,
        expectedConfirmationHash,
        confirmed: true,
        ...(Object.keys(resolutions).length ? { resolutions } : {}),
      }),
    )
    operationId = stringField(applied.operationId)
    if (!operationId) throw new Error("Portability fixture apply returned no operation identity")
    await procedure(
      importExportRouter,
      "restoreBackup",
    )({
      operationId,
      confirmed: true,
    })
    return {
      exported: true,
      planned: true,
      confirmed: true,
      applied: true,
      restored: true,
      cleaned: true,
    }
  } finally {
    await rm(root, { recursive: true, force: true })
    await cleanupPortabilityFixtureState(stateRoot, planId, operationId)
  }
}

export async function runPortabilityLifecycleJob(
  job: PortabilityLifecycleJob,
  runner: () => Promise<Stage4PortabilityLifecycleResult>,
  persist: () => void,
): Promise<void> {
  job.status = "running"
  job.updatedAt = new Date().toISOString()
  persist()
  try {
    job.result = await runner()
    job.status = "completed"
  } catch (error) {
    job.status = "failed"
    job.error = sanitizeStage4ControlError(error).message
  }
  job.updatedAt = new Date().toISOString()
  persist()
}

async function executePortabilityLifecycleJob(jobId: string): Promise<void> {
  ensureRegistryHydrated()
  const job = portabilityLifecycleJobs.get(jobId)
  if (!job || job.status !== "scheduled") return
  await runPortabilityLifecycleJob(
    job,
    () => runStage4PortabilityFixtureForTests(job.projectId),
    persistRegistry,
  )
}

async function exerciseSkillsHooksFixture(ownedId: string) {
  const fixture = requireOwnedFixture(ownedSkills, ownedId, "skill")
  const project = requireOwnedProject(fixture.projectId)
  assertSkillFixtureRecord(ownedId, fixture)
  const name = `stage4-mcp-${ownedId}`
  const source = {
    harness: "claude-code" as const,
    kind: "skill" as const,
    scope: "project" as const,
    name,
    cwd: project.projectPath,
  }
  const target = {
    harness: "codex" as const,
    kind: "skill" as const,
    scope: "project" as const,
    name,
    cwd: project.projectPath,
  }
  const targetPath = join(project.projectPath, ".agents", "skills", name, "SKILL.md")
  if (existsSync(targetPath)) throw new Error("Owned copy target must be absent before exercise")

  const {
    applyCrossHarnessCopy,
    applyNativeExtensionMutation,
    buildExtensionRunContext,
    clearExtensionEnablementPolicy,
    extensionPolicyTargetFromManifest,
    FileHookStateStore,
    HookLifecycleService,
    NodeHookDryRunRunner,
    previewCrossHarnessCopy,
    previewNativeExtensionMutation,
    readNativeExtension,
    resolveExtensionEnablement,
    setExtensionEnablementPolicy,
  } = await import("../extension-management")
  const { discoverProviderExtensions } = await import("../provider-extensions")

  const hookStatePath = process.env.FLAPSTACK_CONFIG_DIR
    ? join(process.env.FLAPSTACK_CONFIG_DIR, "hook-management.json")
    : join(app.getPath("userData"), "data", "hook-management.json")
  const hookStateExisted = existsSync(hookStatePath)
  const hookStateBefore = hookStateExisted ? readFileSync(hookStatePath) : null
  const policyLocations: Array<
    | { type: "user" }
    | { type: "project"; projectId: string }
    | { type: "task"; projectId: string; taskId: string }
  > = []
  let copyCreated = false
  const policyTaskId = randomUUID()
  const policyChatId = randomUUID()
  let policyContextCreated = false
  try {
    const sourceBefore = await readNativeExtension(source)
    const preview = await previewCrossHarnessCopy({
      source,
      target,
      collisionPolicy: "reject",
    })
    if (
      !preview.canApply ||
      preview.status === "unsupported" ||
      !preview.targetDiff ||
      !preview.sourceHash ||
      !preview.confirmationHash
    ) {
      throw new Error("Owned cross-harness copy preview was incomplete")
    }
    const copied = await applyCrossHarnessCopy({
      source,
      target,
      collisionPolicy: "reject",
      expectedSourceHash: preview.sourceHash,
      expectedTargetHash: preview.targetBeforeHash,
      confirmationHash: preview.confirmationHash,
    })
    copyCreated = true
    const sourceAfter = await readNativeExtension(source)
    if (!copied.sourcePreserved || sourceAfter.hash !== sourceBefore.hash) {
      throw new Error("Cross-harness copy did not preserve the owned source")
    }

    const store = new FileHookStateStore(hookStatePath)
    const hook = new HookLifecycleService(
      store,
      new NodeHookDryRunRunner(),
      { request: async () => "approved" as const },
      undefined,
      (cwd) => assertRegisteredWorktree(cwd).canonicalPath,
    )
    const hookCommand =
      process.platform === "win32"
        ? `"${join(process.env.SystemRoot ?? "C:\\Windows", "System32", "where.exe")}" cmd.exe`
        : "/usr/bin/true"
    const imported = await hook.import({
      name: `Stage 4 MCP ${ownedId}`,
      harness: "codex",
      scope: "project",
      cwd: project.projectPath,
      event: "PreToolUse",
      command: hookCommand,
      timeoutMs: 5_000,
    })
    let invalidEnableRejected = false
    try {
      await hook.setEnabled(imported.id, true)
    } catch {
      invalidEnableRejected = true
    }
    const validated = await hook.validate(imported.id)
    const dryRun = await hook.dryRun(imported.id)
    const enabled = await hook.setEnabled(imported.id, true)
    const disabled = await hook.setEnabled(imported.id, false)

    getDatabase().transaction((transaction) => {
      transaction
        .insert(tasks)
        .values({
          id: policyTaskId,
          projectId: project.projectId,
          name: `Stage 4 extension policy ${ownedId}`,
          description: "Owned test-control context; never scheduled.",
          status: "backlog",
          defaultPermissionMode: "read-only",
          primaryWorktreePath: project.projectPath,
        })
        .run()
      transaction
        .insert(chats)
        .values({
          id: policyChatId,
          name: `Stage 4 extension policy ${ownedId}`,
          projectId: project.projectId,
          taskId: policyTaskId,
          scope: "task",
          permissionMode: "read-only",
          harness: "codex",
          initiatorChatId: policyChatId,
          ancestorChatIds: "[]",
        })
        .run()
    })
    policyContextCreated = true
    const manifest = (await discoverProviderExtensions({ cwd: project.projectPath })).find(
      (candidate) =>
        candidate.provider === "codex" &&
        candidate.kind === "skill" &&
        candidate.source === "project" &&
        candidate.name === name,
    )
    if (!manifest) throw new Error("Copied skill was not found in production extension inventory")
    const policyTarget = extensionPolicyTargetFromManifest(manifest)
    const userLocation = { type: "user" as const }
    const projectLocation = { type: "project" as const, projectId: project.projectId }
    const taskLocation = {
      type: "task" as const,
      projectId: project.projectId,
      taskId: policyTaskId,
    }
    setExtensionEnablementPolicy(getDatabase(), {
      target: policyTarget,
      location: userLocation,
      enabled: false,
    })
    policyLocations.push(userLocation)
    const userResolved = resolveExtensionEnablement(getDatabase(), { target: policyTarget })
    setExtensionEnablementPolicy(getDatabase(), {
      target: policyTarget,
      location: projectLocation,
      enabled: true,
    })
    policyLocations.push(projectLocation)
    const projectResolved = resolveExtensionEnablement(getDatabase(), {
      target: policyTarget,
      projectId: project.projectId,
    })
    setExtensionEnablementPolicy(getDatabase(), {
      target: policyTarget,
      location: taskLocation,
      enabled: false,
    })
    policyLocations.push(taskLocation)
    const taskResolved = resolveExtensionEnablement(getDatabase(), {
      target: policyTarget,
      projectId: project.projectId,
      taskId: policyTaskId,
    })
    const blockedRun = await buildExtensionRunContext(getDatabase(), {
      chatId: policyChatId,
      harness: "codex",
      cwd: project.projectPath,
    })
    clearExtensionEnablementPolicy(getDatabase(), { target: policyTarget, location: taskLocation })
    policyLocations.pop()
    const allowedRun = await buildExtensionRunContext(getDatabase(), {
      chatId: policyChatId,
      harness: "codex",
      cwd: project.projectPath,
    })

    return {
      copy: {
        exactDiff: copied.targetDiff === preview.targetDiff,
        sourcePreserved: copied.sourcePreserved,
        targetCleaned: true,
      },
      hook: {
        importedDisabled: imported.state === "discovered" && !imported.enabled,
        invalidEnableRejected,
        validatedBeforeDryRun: validated.state === "validated",
        dryRunPassedBeforeEnable: dryRun.state === "dry-run-passed",
        enabledThenDisabled: enabled.record.enabled && disabled.record.state === "disabled",
        stateRestored: true,
      },
      enablement: {
        user: userResolved.enabled,
        project: projectResolved.enabled,
        task: taskResolved.enabled,
        nextRunEnforced:
          blockedRun.manifest.disabledExtensionIds.includes(manifest.id) &&
          allowedRun.manifest.enabledExtensionIds.includes(manifest.id),
        policiesRestored: true,
      },
    }
  } finally {
    const manifests = await discoverProviderExtensions({ cwd: project.projectPath }).catch(() => [])
    const manifest = manifests.find(
      (candidate) =>
        candidate.provider === "codex" &&
        candidate.kind === "skill" &&
        candidate.source === "project" &&
        candidate.name === name,
    )
    if (manifest) {
      const policyTarget = extensionPolicyTargetFromManifest(manifest)
      for (const location of policyLocations.reverse()) {
        clearExtensionEnablementPolicy(getDatabase(), { target: policyTarget, location })
      }
    }
    if (copyCreated && existsSync(targetPath)) {
      const deletion = await previewNativeExtensionMutation({
        operation: "delete",
        target,
      })
      await applyNativeExtensionMutation({
        operation: "delete",
        target,
        expectedHash: deletion.beforeHash,
        confirmationHash: deletion.confirmationHash,
      })
    }
    if (policyContextCreated) {
      getDatabase().transaction((transaction) => {
        transaction.delete(chats).where(eq(chats.id, policyChatId)).run()
        transaction.delete(tasks).where(eq(tasks.id, policyTaskId)).run()
      })
    }
    if (hookStateBefore) {
      writeStage4RegistryAtomically(hookStatePath, hookStateBefore.toString("utf8"))
    } else if (!hookStateExisted) {
      rmSync(hookStatePath, { force: true })
    }
  }
}

function startPortabilityLifecycleJob(projectId: string): PortabilityLifecycleJob {
  requireOwnedProject(projectId)
  const active = [...portabilityLifecycleJobs.values()].find(
    (job) => job.status === "scheduled" || job.status === "running",
  )
  if (active) throw new Error("An owned portability lifecycle job is already active.")
  if (portabilityLifecycleJobs.size >= 20) {
    throw new Error("Clean completed portability lifecycle jobs before starting another.")
  }
  const now = new Date().toISOString()
  const job: PortabilityLifecycleJob = {
    jobId: randomUUID(),
    projectId,
    ownerPid: process.pid,
    status: "scheduled",
    createdAt: now,
    updatedAt: now,
  }
  portabilityLifecycleJobs.set(job.jobId, job)
  persistRegistry()
  const timer = setTimeout(() => {
    portabilityLifecycleTimers.delete(job.jobId)
    void executePortabilityLifecycleJob(job.jobId)
  }, 750)
  portabilityLifecycleTimers.set(job.jobId, timer)
  return job
}

function getPortabilityLifecycleJob(jobId: string): PortabilityLifecycleJob {
  ensureRegistryHydrated()
  const job = portabilityLifecycleJobs.get(jobId)
  if (!job) throw new Error("Owned portability lifecycle job was not found.")
  return job
}

function cleanupPortabilityLifecycleJob(jobId: string): {
  jobId: string
  cleaned: true
} {
  const job = getPortabilityLifecycleJob(jobId)
  if (job.status === "scheduled" || job.status === "running") {
    throw new Error("Owned portability lifecycle job is still active.")
  }
  portabilityLifecycleJobs.delete(jobId)
  persistRegistry()
  return { jobId, cleaned: true }
}

async function runStage4Mutation(
  action: Stage4OperationalAction,
  payload: Record<string, unknown>,
) {
  if (action === "enable-stage4-beta-fixtures") {
    z.object({}).strict().parse(payload)
    const { getBetaFeatureSettings } = await import("../beta-features/settings")
    const { betaFeaturesRouter } = await import("../trpc/routers/beta-features")
    const current = getBetaFeatureSettings()
    const features = ["projectMemory", "savedWorkspaces", "automations", "planning"] as const
    for (const feature of features) {
      if (!betaFixtureOriginals.has(feature)) betaFixtureOriginals.set(feature, current[feature])
    }
    persistRegistry()
    for (const feature of features) {
      if (!current[feature]) await procedure(betaFeaturesRouter, "set")({ feature, enabled: true })
    }
    return { enabled: true, features }
  }

  if (action === "restore-stage4-beta-fixtures") {
    z.object({}).strict().parse(payload)
    const { betaFeaturesRouter } = await import("../trpc/routers/beta-features")
    for (const [feature, enabled] of betaFixtureOriginals) {
      await procedure(betaFeaturesRouter, "set")({ feature, enabled })
    }
    betaFixtureOriginals.clear()
    persistRegistry()
    return { restored: true }
  }

  if (action === "cleanup-all-owned-fixtures") {
    z.object({}).strict().parse(payload)
    return cleanupAllOwnedFixtures()
  }

  if (action === "create-project-skill-fixture") {
    const parsed = z.object({ projectId: id }).strict().parse(payload)
    const project = requireOwnedProject(parsed.projectId)
    const ownedId = randomUUID()
    const name = `stage4-mcp-${ownedId}`
    const { skillsRouter } = await import("../trpc/routers/skills")
    await procedure(
      skillsRouter,
      "create",
    )({
      cwd: project.projectPath,
      name,
      description: "Bounded Stage 4 MCP fixture.",
      content: "Production skill persistence proof. No external actions.",
      source: "project",
    })
    ownedSkills.set(ownedId, {
      projectId: project.projectId,
      projectPath: project.projectPath,
      relativePath: skillFixtureRelativePath(ownedId),
    })
    persistRegistry()
    return { fixtureId: ownedId, name }
  }

  if (action === "exercise-skills-hooks-fixture") {
    return exerciseSkillsHooksFixture(fixtureId(payload))
  }

  if (action === "cleanup-project-skill-fixture") {
    const ownedId = fixtureId(payload)
    const fixture = ownedSkills.get(ownedId)
    if (!fixture) return { fixtureId: ownedId, cleaned: false }
    requireOwnedProject(fixture.projectId)
    if (!existsSync(join(fixture.projectPath, fixture.relativePath))) {
      ownedSkills.delete(ownedId)
      persistRegistry()
      return { fixtureId: ownedId, cleaned: true, alreadyMissing: true }
    }
    assertSkillFixtureRecord(ownedId, fixture)
    const { skillsRouter } = await import("../trpc/routers/skills")
    maybeFailCleanupForTests("skill")
    await procedure(
      skillsRouter,
      "delete",
    )({
      cwd: fixture.projectPath,
      path: fixture.relativePath,
    })
    ownedSkills.delete(ownedId)
    persistRegistry()
    return { fixtureId: ownedId, cleaned: true }
  }

  if (action === "create-project-vault-fixture") {
    const parsed = z.object({ projectId: id }).strict().parse(payload)
    requireOwnedProject(parsed.projectId)
    if ([...ownedVaults.values()].some((fixture) => fixture.projectId === parsed.projectId)) {
      throw new Error("Owned project already has a vault fixture")
    }
    const existingPolicy = getDatabase()
      .select({ projectId: projectVaultPolicies.projectId })
      .from(projectVaultPolicies)
      .where(eq(projectVaultPolicies.projectId, parsed.projectId))
      .get()
    const existingVault = getDatabase()
      .select({ projectId: projectVaults.projectId })
      .from(projectVaults)
      .where(eq(projectVaults.projectId, parsed.projectId))
      .get()
    if (existingPolicy || existingVault) {
      throw new Error("Project vault fixtures require an empty owned test-project vault state")
    }
    const { projectVaultsRouter } = await import("../trpc/routers/project-vaults")
    await procedure(
      projectVaultsRouter,
      "scaffold",
    )({
      projectId: parsed.projectId,
      sections: ["index", "handoff"],
    })
    const createdVault = getDatabase()
      .select({ rootPath: projectVaults.rootPath })
      .from(projectVaults)
      .where(eq(projectVaults.projectId, parsed.projectId))
      .get()
    if (!createdVault) throw new Error("Project vault fixture creation returned no record")
    const ownedId = randomUUID()
    ownedVaults.set(ownedId, {
      projectId: parsed.projectId,
      rootFingerprint: fingerprint(createdVault.rootPath),
    })
    persistRegistry()
    return { fixtureId: ownedId, projectId: parsed.projectId }
  }

  if (action === "write-project-vault-fixture") {
    const ownedId = fixtureId(payload)
    const fixture = requireOwnedFixture(ownedVaults, ownedId, "project vault")
    requireOwnedProject(fixture.projectId)
    const currentVault = getDatabase()
      .select({ rootPath: projectVaults.rootPath })
      .from(projectVaults)
      .where(eq(projectVaults.projectId, fixture.projectId))
      .get()
    if (!currentVault || fingerprint(currentVault.rootPath) !== fixture.rootFingerprint) {
      throw new Error("Owned project vault metadata does not match its registry identity")
    }
    const { projectVaultsRouter } = await import("../trpc/routers/project-vaults")
    const sections = (await procedure(
      projectVaultsRouter,
      "listSections",
    )({
      projectId: fixture.projectId,
    })) as Array<Record<string, unknown>>
    const section = sections.find((item) => item.sectionId === "index")
    if (!section) throw new Error("Owned project vault fixture is incomplete")
    const originalVersion = numberField(section.version)
    const originalHash = stringField(section.contentHash)
    if (!originalVersion || !originalHash) {
      throw new Error("Owned project vault fixture section identity is incomplete")
    }
    const updated = record(
      await procedure(
        projectVaultsRouter,
        "writeSection",
      )({
        projectId: fixture.projectId,
        sectionId: "index",
        expectedVersion: originalVersion,
        expectedCurrentContentHash: originalHash,
        content: "# Stage 4 MCP fixture\n\nProduction vault write proof.\n",
      }),
    )
    const updatedVersion = numberField(updated.version)
    const updatedHash = stringField(updated.contentHash)
    if (!updatedVersion || !updatedHash) {
      throw new Error("Owned project vault fixture update is incomplete")
    }
    let conflictRejected = false
    try {
      await procedure(
        projectVaultsRouter,
        "writeSection",
      )({
        projectId: fixture.projectId,
        sectionId: "index",
        expectedVersion: originalVersion,
        expectedCurrentContentHash: originalHash,
        content: "stale owned fixture write",
      })
    } catch {
      conflictRejected = true
    }
    let unsafeContentRejected = false
    try {
      const syntheticApiKey = ["sk", "abcdefghijklmnopqrstuvwxyz123456"].join("-")
      await procedure(
        projectVaultsRouter,
        "writeSection",
      )({
        projectId: fixture.projectId,
        sectionId: "index",
        expectedVersion: updatedVersion,
        expectedCurrentContentHash: updatedHash,
        content: `OPENAI_API_KEY=${syntheticApiKey}`,
      })
    } catch {
      unsafeContentRejected = true
    }
    const backups = (await procedure(
      projectVaultsRouter,
      "listBackups",
    )({
      projectId: fixture.projectId,
      sectionId: "index",
    })) as Array<Record<string, unknown>>
    const backupId = stringField(record(backups[0]).id)
    if (!backupId) throw new Error("Owned project vault fixture created no restorable backup")
    const restored = await procedure(
      projectVaultsRouter,
      "restoreBackup",
    )({
      projectId: fixture.projectId,
      sectionId: "index",
      backupId,
      expectedVersion: updatedVersion,
    })
    return {
      fixtureId: ownedId,
      updated,
      restored,
      conflictRejected,
      unsafeContentRejected,
      backupRestored: true,
    }
  }

  if (action === "cleanup-project-vault-fixture") {
    const ownedId = fixtureId(payload)
    const fixture = ownedVaults.get(ownedId)
    if (!fixture) return { fixtureId: ownedId, cleaned: false }
    requireOwnedProject(fixture.projectId)
    const existing = getDatabase()
      .select({ projectId: projectVaults.projectId, rootPath: projectVaults.rootPath })
      .from(projectVaults)
      .where(eq(projectVaults.projectId, fixture.projectId))
      .get()
    if (!existing) {
      ownedVaults.delete(ownedId)
      persistRegistry()
      return { fixtureId: ownedId, cleaned: true, alreadyMissing: true }
    }
    if (fingerprint(existing.rootPath) !== fixture.rootFingerprint) {
      throw new Error("Owned project vault metadata does not match its registry identity")
    }
    const { projectVaultsRouter } = await import("../trpc/routers/project-vaults")
    const contract = record(
      await procedure(
        projectVaultsRouter,
        "getDeleteContract",
      )({
        projectId: fixture.projectId,
      }),
    )
    const confirmationPhrase = stringField(contract.requiredPhrase)
    if (!confirmationPhrase) throw new Error("Project vault delete contract is incomplete")
    maybeFailCleanupForTests("vault")
    await procedure(projectVaultsRouter, "deleteVault")({ contract, confirmationPhrase })
    ownedVaults.delete(ownedId)
    persistRegistry()
    return { fixtureId: ownedId, cleaned: true }
  }

  if (action === "create-workspace-fixture") {
    const parsed = z.object({ projectId: id }).strict().parse(payload)
    requireOwnedProject(parsed.projectId)
    const ownedId = randomUUID()
    const { savedWorkspacesRouter } = await import("../trpc/routers/saved-workspaces")
    const created = record(
      await procedure(
        savedWorkspacesRouter,
        "create",
      )({
        name: workspaceFixtureName(ownedId),
        scope: { type: "project", projectId: parsed.projectId },
        layout: {
          version: 1,
          root: {
            type: "tabs",
            id: `stage4-tabs-${ownedId}`,
            activePaneId: `stage4-pane-${ownedId}`,
            panes: [
              {
                id: `stage4-pane-${ownedId}`,
                title: "Verification",
                binding: { type: "browser", url: "https://example.invalid/stage4-verification" },
              },
            ],
          },
        },
      }),
    )
    const workspaceId = stringField(record(created.workspace).id)
    if (!workspaceId) throw new Error("Workspace fixture creation returned no record")
    ownedWorkspaces.set(ownedId, { projectId: parsed.projectId, recordId: workspaceId })
    persistRegistry()
    return { fixtureId: ownedId, workspaceId }
  }

  if (action === "mutate-workspace-fixture") {
    const parsed = z
      .object({
        fixtureId: z.string().uuid(),
        operation: z.enum(["rename", "archive", "restore", "exercise-layout"]),
      })
      .strict()
      .parse(payload)
    const fixture = requireOwnedFixture(ownedWorkspaces, parsed.fixtureId, "workspace")
    requireOwnedProject(fixture.projectId)
    const { savedWorkspacesRouter } = await import("../trpc/routers/saved-workspaces")
    const current = record(
      await procedure(savedWorkspacesRouter, "get")({ workspaceId: fixture.recordId }),
    )
    assertWorkspaceFixtureRecord(current, parsed.fixtureId)
    const expectedVersion = numberField(current.version)
    if (!expectedVersion) throw new Error("Owned workspace fixture has no version")
    if (parsed.operation === "exercise-layout") {
      let corruptLayoutRejected = false
      try {
        await procedure(
          savedWorkspacesRouter,
          "saveLayout",
        )({
          workspaceId: fixture.recordId,
          expectedVersion,
          layout: {
            version: 1,
            root: {
              type: "tabs",
              id: `stage4-corrupt-tabs-${parsed.fixtureId}`,
              activePaneId: "missing-pane",
              panes: [
                {
                  id: `stage4-corrupt-pane-${parsed.fixtureId}`,
                  binding: { type: "browser", url: "https://example.invalid/corrupt" },
                },
              ],
            },
          },
        })
      } catch {
        corruptLayoutRejected = true
      }
      await procedure(
        savedWorkspacesRouter,
        "saveLayout",
      )({
        workspaceId: fixture.recordId,
        expectedVersion,
        layout: {
          version: 1,
          root: {
            type: "tabs",
            id: `stage4-exercise-tabs-${parsed.fixtureId}`,
            activePaneId: `stage4-browser-${parsed.fixtureId}`,
            panes: [
              {
                id: `stage4-browser-${parsed.fixtureId}`,
                title: "Verification",
                binding: { type: "browser", url: "https://example.invalid/stage4-verification" },
              },
              {
                id: `stage4-terminal-${parsed.fixtureId}`,
                title: "Terminal",
                binding: {
                  type: "terminal",
                  cwd: requireOwnedProject(fixture.projectId).projectPath,
                  worktreePath: requireOwnedProject(fixture.projectId).projectPath,
                  restorePolicy: "never",
                },
              },
            ],
          },
        },
      })
      const saved = record(
        await procedure(savedWorkspacesRouter, "get")({ workspaceId: fixture.recordId }),
      )
      assertWorkspaceFixtureRecord(saved, parsed.fixtureId)
      const summary = redactStage4Workspace(saved)
      for (const paneId of [
        `stage4-browser-${parsed.fixtureId}`,
        `stage4-terminal-${parsed.fixtureId}`,
      ]) {
        await procedure(
          savedWorkspacesRouter,
          "resolvePane",
        )({ workspaceId: fixture.recordId, paneId })
      }
      return {
        fixtureId: parsed.fixtureId,
        operation: parsed.operation,
        paneCount: summary.paneCount,
        bindingTypes: summary.bindingTypes,
        corruptLayoutRejected,
      }
    }
    if (parsed.operation === "rename") {
      await procedure(
        savedWorkspacesRouter,
        "rename",
      )({
        workspaceId: fixture.recordId,
        expectedVersion,
        name: workspaceFixtureName(parsed.fixtureId, true),
      })
    } else {
      await procedure(
        savedWorkspacesRouter,
        parsed.operation,
      )({
        workspaceId: fixture.recordId,
        expectedVersion,
      })
    }
    return { fixtureId: parsed.fixtureId, operation: parsed.operation }
  }

  if (action === "cleanup-workspace-fixture") {
    const ownedId = fixtureId(payload)
    const fixture = ownedWorkspaces.get(ownedId)
    if (!fixture) return { fixtureId: ownedId, cleaned: false }
    requireOwnedProject(fixture.projectId)
    const { savedWorkspacesRouter } = await import("../trpc/routers/saved-workspaces")
    let current: Record<string, unknown>
    try {
      current = record(
        await procedure(savedWorkspacesRouter, "get")({ workspaceId: fixture.recordId }),
      )
    } catch (error) {
      if (!/not found/i.test(error instanceof Error ? error.message : String(error))) throw error
      ownedWorkspaces.delete(ownedId)
      persistRegistry()
      return { fixtureId: ownedId, cleaned: true, alreadyMissing: true }
    }
    assertWorkspaceFixtureRecord(current, ownedId)
    const expectedVersion = numberField(current.version)
    if (!expectedVersion) throw new Error("Owned workspace fixture has no version")
    maybeFailCleanupForTests("workspace")
    await procedure(
      savedWorkspacesRouter,
      "delete",
    )({
      workspaceId: fixture.recordId,
      expectedVersion,
    })
    ownedWorkspaces.delete(ownedId)
    persistRegistry()
    return { fixtureId: ownedId, cleaned: true }
  }

  if (action === "create-automation-fixture") {
    const parsed = z.object({ projectId: id }).strict().parse(payload)
    requireOwnedProject(parsed.projectId)
    const ownedId = randomUUID()
    const { automationsRouter } = await import("../trpc/routers/automations")
    const created = record(
      await procedure(
        automationsRouter,
        "createDraft",
      )({
        idempotencyKey: `stage4-mcp-${ownedId}`,
        draft: {
          name: `Stage 4 MCP fixture ${ownedId}`,
          description: "Bounded Stage 4 verification fixture.",
          scope: { type: "project", projectId: parsed.projectId },
          action: { type: "create-chat-run", chatName: "[Dev] Automation verification" },
          trigger: { type: "manual" },
          run: {
            prompt: "Reply with STAGE4_AUTOMATION_OK. Do not edit files.",
            harness: "codex",
            permissionMode: "read-only",
            worktreeStrategy: "inherit",
          },
        },
      }),
    )
    const automationId = stringField(record(created.record).id)
    if (!automationId) throw new Error("Automation fixture creation returned no record")
    ownedAutomations.set(ownedId, { projectId: parsed.projectId, recordId: automationId })
    persistRegistry()
    return { fixtureId: ownedId, automationId }
  }

  if (action === "mutate-automation-fixture") {
    const parsed = z
      .object({
        fixtureId: z.string().uuid(),
        operation: z.enum(["dry-run", "approve", "resume", "pause"]),
      })
      .strict()
      .parse(payload)
    const fixture = requireOwnedFixture(ownedAutomations, parsed.fixtureId, "automation")
    requireOwnedProject(fixture.projectId)
    const { automationsRouter } = await import("../trpc/routers/automations")
    const current = record(
      await procedure(automationsRouter, "get")({ automationId: fixture.recordId }),
    )
    assertAutomationFixtureRecord(current, parsed.fixtureId)
    if (parsed.operation === "dry-run") {
      const preview = await procedure(
        automationsRouter,
        "dryRun",
      )({
        automationId: fixture.recordId,
      })
      return {
        fixtureId: parsed.fixtureId,
        operation: parsed.operation,
        preview: summarizeStage4AutomationPreview(preview),
      }
    } else {
      const expectedVersion = numberField(current.version)
      if (!expectedVersion) throw new Error("Owned automation fixture has no version")
      if (parsed.operation === "approve") {
        await procedure(
          automationsRouter,
          "reviewDraft",
        )({
          automationId: fixture.recordId,
          expectedVersion,
          decision: "approve",
          enable: false,
        })
      } else {
        await procedure(
          automationsRouter,
          "setEnabled",
        )({
          automationId: fixture.recordId,
          expectedVersion,
          enabled: parsed.operation === "resume",
        })
      }
    }
    return { fixtureId: parsed.fixtureId, operation: parsed.operation }
  }

  if (action === "cleanup-automation-fixture") {
    const ownedId = fixtureId(payload)
    const fixture = ownedAutomations.get(ownedId)
    if (!fixture) return { fixtureId: ownedId, cleaned: false }
    requireOwnedProject(fixture.projectId)
    const { automationsRouter } = await import("../trpc/routers/automations")
    let current: Record<string, unknown>
    try {
      current = record(
        await procedure(automationsRouter, "get")({ automationId: fixture.recordId }),
      )
    } catch (error) {
      if (!/not found/i.test(error instanceof Error ? error.message : String(error))) throw error
      ownedAutomations.delete(ownedId)
      persistRegistry()
      return { fixtureId: ownedId, cleaned: true, alreadyMissing: true }
    }
    assertAutomationFixtureRecord(current, ownedId)
    const expectedVersion = numberField(current.version)
    if (!expectedVersion) throw new Error("Owned automation fixture has no version")
    maybeFailCleanupForTests("automation")
    await procedure(
      automationsRouter,
      "delete",
    )({
      automationId: fixture.recordId,
      expectedVersion,
    })
    ownedAutomations.delete(ownedId)
    persistRegistry()
    return { fixtureId: ownedId, cleaned: true }
  }

  if (action === "refresh-local-model-fixture") {
    z.object({}).strict().parse(payload)
    const [{ localModelsRouter }, { isLocalModelDevFixtureEnabled }, { app }] = await Promise.all([
      import("../trpc/routers/local-models"),
      import("../harness/local-model-dev-fixture"),
      import("electron"),
    ])
    if (
      !isLocalModelDevFixtureEnabled({
        isPackaged: app.isPackaged,
        rendererUrl: process.env.ELECTRON_RENDERER_URL,
      })
    ) {
      throw new Error("Local-model fixtures require an unpackaged Dev instance")
    }
    return procedure(localModelsRouter, "catalog")({ endpoint: "http://127.0.0.1:43127" })
  }

  if (action === "exercise-real-ollama-fixture") {
    const parsed = validateRealOllamaFixtureInput(payload)
    const project = requireOwnedProject(parsed.projectId)
    const chatId = `stage4-ollama-chat-${randomUUID()}`
    const subChatId = `stage4-ollama-subchat-${randomUUID()}`
    const runId = `stage4-ollama-run-${randomUUID()}`
    const db = getDatabase()
    let result: Record<string, unknown> | null = null
    try {
      db.insert(chats)
        .values({
          id: chatId,
          name: "Stage 4 owned real-Ollama verification",
          projectId: parsed.projectId,
          scope: "project",
          permissionMode: "read-only",
          harness: "local",
          model: parsed.model,
          ancestorChatIds: "[]",
          worktreePath: project.projectPath,
        })
        .run()
      db.insert(subChats)
        .values({
          id: subChatId,
          name: "Stage 4 owned real-Ollama stream",
          chatId,
          mode: "read",
          harness: "local",
          model: parsed.model,
          permissionMode: "read-only",
          worktreePath: project.projectPath,
          messages: "[]",
        })
        .run()

      const { localModelsRouter } = await import("../trpc/routers/local-models")
      const catalog = record(
        await procedure(localModelsRouter, "catalog")({ endpoint: parsed.endpoint }),
      )
      const catalogModels = Array.isArray(catalog.models) ? catalog.models.map(record) : []
      const exactModel = catalogModels.find(
        (entry) =>
          stringField(record(entry.identity).provider) === "ollama" &&
          stringField(record(entry.identity).modelId) === parsed.model,
      )
      if (catalog.state !== "ready" || !exactModel) {
        throw new Error("The exact requested Ollama model was not ready in the production catalog")
      }

      const stream = await procedure(
        localModelsRouter,
        "chat",
      )({
        chatId,
        subChatId,
        runId,
        prompt: "Respond with these five words and no tool calls: FLAPSTACK OLLAMA LOCAL STREAM OK",
        mode: "read",
        model: parsed.model,
        endpoint: parsed.endpoint,
        cwd: project.projectPath,
        projectPath: project.projectPath,
      })
      const chunks = (await collectStage4Observable(stream)).map(record)
      const errors = chunks.filter((chunk) => chunk.type === "error")
      if (errors.length > 0) {
        throw new Error(stringField(errors[0]?.errorText) ?? "The real Ollama stream failed")
      }
      const textDeltas = chunks
        .filter((chunk) => chunk.type === "text-delta")
        .map((chunk) => stringField(chunk.delta) ?? "")
        .filter(Boolean)
      const text = textDeltas.join("")
      if (textDeltas.length < 2 || !text.trim()) {
        throw new Error("The real Ollama response did not demonstrate streamed text")
      }
      if (!chunks.some((chunk) => chunk.type === "finish")) {
        throw new Error("The real Ollama stream did not finish")
      }

      const run = db
        .select({
          status: agentRuns.status,
          harness: agentRuns.harness,
          model: agentRuns.model,
        })
        .from(agentRuns)
        .where(eq(agentRuns.id, runId))
        .get()
      if (run?.status !== "success" || run.harness !== "local" || run.model !== parsed.model) {
        throw new Error("The real Ollama run did not persist the exact successful model identity")
      }
      const usage = db
        .select({
          providerId: usageSamples.providerId,
          model: usageSamples.model,
          inputTokens: usageSamples.inputTokens,
          outputTokens: usageSamples.outputTokens,
          totalTokens: usageSamples.totalTokens,
          costUsd: usageSamples.costUsd,
          costQuality: usageSamples.costQuality,
        })
        .from(usageSamples)
        .where(eq(usageSamples.runId, runId))
        .get()
      if (
        usage?.providerId !== "local" ||
        usage.model !== parsed.model ||
        !usage.inputTokens ||
        !usage.outputTokens ||
        !usage.totalTokens ||
        usage.costUsd !== 0 ||
        usage.costQuality !== "exact"
      ) {
        throw new Error("The real Ollama run did not persist exact local usage")
      }
      const stored = db
        .select({ messages: subChats.messages })
        .from(subChats)
        .where(eq(subChats.id, subChatId))
        .get()
      const messages = stored ? JSON.parse(stored.messages) : []
      const persistedMetadata = extractRealOllamaPersistedMetadata(messages, runId)
      const fallback = persistedMetadata.fallback
      if (
        persistedMetadata.harness !== "local" ||
        persistedMetadata.modelId !== parsed.model ||
        fallback.mode !== "none" ||
        fallback.cloudAllowed !== false ||
        fallback.reason !== "cloud-fallback-disabled"
      ) {
        throw new Error("The real Ollama run did not persist the no-cloud-fallback contract")
      }

      result = {
        state: "completed",
        provider: "ollama",
        model: parsed.model,
        catalogIdentityConfirmed: true,
        streaming: {
          textDeltaCount: textDeltas.length,
          textLength: text.length,
          textFingerprint: fingerprint(text),
          finished: true,
        },
        usage: summarizeRealOllamaUsageEvidence(usage),
        fallback,
      }
    } finally {
      const { localModelsRouter } = await import("../trpc/routers/local-models")
      await procedure(localModelsRouter, "cancel")({ runId }).catch(() => undefined)
      db.delete(usageSamples).where(eq(usageSamples.runId, runId)).run()
      db.delete(agentRuns).where(eq(agentRuns.id, runId)).run()
      db.delete(subChats).where(eq(subChats.id, subChatId)).run()
      db.delete(chats).where(eq(chats.id, chatId)).run()
    }
    if (!result) throw new Error("The real Ollama verification produced no result")
    const cleanupConfirmed =
      !db.select({ id: chats.id }).from(chats).where(eq(chats.id, chatId)).get() &&
      !db.select({ id: subChats.id }).from(subChats).where(eq(subChats.id, subChatId)).get() &&
      !db.select({ id: agentRuns.id }).from(agentRuns).where(eq(agentRuns.id, runId)).get() &&
      !db
        .select({ id: usageSamples.id })
        .from(usageSamples)
        .where(eq(usageSamples.runId, runId))
        .get()
    if (!cleanupConfirmed) throw new Error("The owned real Ollama fixture did not clean up")
    return { ...result, cleanupConfirmed: true }
  }

  if (action === "create-usage-budget-fixture") {
    const parsed = z.object({ projectId: id }).strict().parse(payload)
    requireOwnedProject(parsed.projectId)
    const ownedId = randomUUID()
    const { usageRouter } = await import("../trpc/routers/usage")
    const created = record(
      await procedure(
        usageRouter,
        "createBudget",
      )({
        name: `Stage 4 MCP fixture ${ownedId}`,
        enabled: true,
        scope: { type: "project", projectId: parsed.projectId },
        threshold: { type: "total-tokens", value: 1_000_000 },
        action: "soft-alert",
        reset: { type: "none" },
      }),
    )
    const budgetId = stringField(created.id)
    if (!budgetId) throw new Error("Usage budget fixture creation returned no record")
    ownedBudgets.set(ownedId, { projectId: parsed.projectId, recordId: budgetId })
    persistRegistry()
    return { fixtureId: ownedId, budgetId }
  }

  if (action === "cleanup-usage-budget-fixture") {
    const ownedId = fixtureId(payload)
    const fixture = ownedBudgets.get(ownedId)
    if (!fixture) return { fixtureId: ownedId, cleaned: false }
    requireOwnedProject(fixture.projectId)
    const { usageRouter } = await import("../trpc/routers/usage")
    const currentValue = await procedure(usageRouter, "getBudget")({ id: fixture.recordId })
    if (!currentValue) {
      ownedBudgets.delete(ownedId)
      persistRegistry()
      return { fixtureId: ownedId, cleaned: true, alreadyMissing: true }
    }
    const current = record(currentValue)
    assertBudgetFixtureRecord(current, ownedId)
    const expectedVersion = numberField(current.version)
    if (!expectedVersion) throw new Error("Owned usage budget fixture has no version")
    maybeFailCleanupForTests("budget")
    await procedure(
      usageRouter,
      "deleteBudget",
    )({
      id: fixture.recordId,
      expectedVersion,
    })
    ownedBudgets.delete(ownedId)
    persistRegistry()
    return { fixtureId: ownedId, cleaned: true }
  }

  if (action === "start-portability-lifecycle-fixture") {
    const parsed = z.object({ projectId: id }).strict().parse(payload)
    return startPortabilityLifecycleJob(parsed.projectId)
  }

  if (action === "get-portability-lifecycle-fixture") {
    const parsed = z.object({ jobId: z.string().uuid() }).strict().parse(payload)
    return getPortabilityLifecycleJob(parsed.jobId)
  }

  if (action === "cleanup-portability-lifecycle-fixture") {
    const parsed = z.object({ jobId: z.string().uuid() }).strict().parse(payload)
    return cleanupPortabilityLifecycleJob(parsed.jobId)
  }

  if (action === "create-plan-fixture") {
    const parsed = z.object({ projectId: id }).strict().parse(payload)
    requireOwnedProject(parsed.projectId)
    if ([...ownedPlans.values()].some((fixture) => fixture.projectId === parsed.projectId)) {
      throw new Error("Owned project already has a planning fixture")
    }
    const { planSourcesRouter } = await import("../trpc/routers/plan-sources")
    await procedure(planSourcesRouter, "devFixtureCreate")(parsed)
    const ownedId = randomUUID()
    ownedPlans.set(ownedId, { projectId: parsed.projectId })
    persistRegistry()
    return { fixtureId: ownedId, projectId: parsed.projectId }
  }

  if (action === "exercise-plan-fixture") {
    const ownedId = fixtureId(payload)
    const fixture = requireOwnedFixture(ownedPlans, ownedId, "planning")
    requireOwnedProject(fixture.projectId)
    const [
      { planSourcesRouter },
      { taskProposalsRouter },
      { DEV_PLAN_MARKDOWN_PATH, DEV_PLAN_OPENSPEC_ROOT },
    ] = await Promise.all([
      import("../trpc/routers/plan-sources"),
      import("../trpc/routers/task-proposals"),
      import("../plan-kanban-dev-fixtures"),
    ])
    const listed = record(
      await procedure(
        taskProposalsRouter,
        "list",
      )({
        projectId: fixture.projectId,
        includeArchived: true,
        limit: 100,
      }),
    )
    const proposals = (Array.isArray(listed.items) ? listed.items : [])
      .map(record)
      .filter((proposal) => {
        const sourcePath = stringField(record(proposal.source).sourcePath)
        return (
          proposal.projectId === fixture.projectId &&
          proposal.status === "pending" &&
          (sourcePath === DEV_PLAN_MARKDOWN_PATH ||
            sourcePath === `${DEV_PLAN_OPENSPEC_ROOT}/tasks.md`)
        )
      })
    if (proposals.length !== 2) throw new Error("Owned planning fixture proposal set is incomplete")
    const approved = proposals[0]!
    const denied = proposals[1]!
    const approvedId = stringField(approved.id)
    const approvedVersion = numberField(approved.version)
    const deniedId = stringField(denied.id)
    const deniedVersion = numberField(denied.version)
    if (!approvedId || !approvedVersion || !deniedId || !deniedVersion) {
      throw new Error("Owned planning fixture proposal identity is incomplete")
    }
    await procedure(
      taskProposalsRouter,
      "approve",
    )({
      proposalId: approvedId,
      expectedVersion: approvedVersion,
      review: {
        taskName: "[Dev] Stage 4 MCP accepted fixture",
        taskDescription: null,
        status: "backlog",
        permissionMode: "read-only",
        customPermissions: null,
        worktreeMode: "project-checkout",
        seedText: "Review the inert Stage 4 planning fixture. Do not launch a run.",
      },
    })
    await procedure(
      taskProposalsRouter,
      "deny",
    )({
      proposalId: deniedId,
      expectedVersion: deniedVersion,
    })
    await procedure(planSourcesRouter, "devFixtureAdvance")({ projectId: fixture.projectId })
    return { fixtureId: ownedId, advanced: true, approved: 1, denied: 1 }
  }

  if (action === "cleanup-plan-fixture") {
    const ownedId = fixtureId(payload)
    const fixture = ownedPlans.get(ownedId)
    if (!fixture) return { fixtureId: ownedId, cleaned: false }
    requireOwnedProject(fixture.projectId)
    const { planSourcesRouter } = await import("../trpc/routers/plan-sources")
    maybeFailCleanupForTests("plan")
    await procedure(planSourcesRouter, "devFixtureReset")({ projectId: fixture.projectId })
    ownedPlans.delete(ownedId)
    persistRegistry()
    return { fixtureId: ownedId, cleaned: true }
  }

  throw new Error(`Unsupported Stage 4 operational action: ${action}`)
}

export async function resetStage4OperationalFixturesForTests(): Promise<void> {
  ensureRegistryHydrated()
  await mutateStage4OperationalState({ action: "cleanup-all-owned-fixtures" }).catch(
    () => undefined,
  )
  for (const timer of portabilityLifecycleTimers.values()) clearTimeout(timer)
  portabilityLifecycleTimers.clear()
  portabilityLifecycleJobs.clear()
  cleanupFailuresOnce.clear()
  persistRegistry()
}
