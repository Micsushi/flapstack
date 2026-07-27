import { randomUUID } from "node:crypto"
import {
  chmodSync,
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { dirname, join } from "node:path"
import { z } from "zod"

type Payload = Record<string, unknown>
type ProfileRef = { profileId: string; version: number; projectId: string | null }
type StandaloneOwnership = { launchId: string; chatId: string }

type Fixture = {
  projectId: string
  chatId: string
  subChatId: string
  harness: string
  defaultVersion: number | null
  activitySeeded: boolean
  activityRuns: Map<string, string>
  continuations: Map<string, string>
  profiles: Map<string, ProfileRef>
  bundles: Map<string, string>
  imports: Map<string, { previewId: string; digest: string }>
  workflows: Map<string, { workflowRunId: string; taskId: string; stepIds: Set<string> }>
  workflowVersions: Map<string, number>
  workflowBundles: Map<string, string>
  standalonePreviews: Map<string, Payload>
  standaloneLaunches: Map<string, StandaloneOwnership>
}

const fixtures = new Map<string, Fixture>()
let journalPath: string | null = null
const JOURNAL_FILENAME = "stage4-runtime-profile-ownership.json"
const MAX_PERSISTED_FIXTURES = 100
const MAX_JOURNAL_BYTES = 2_000_000

type PersistedFixture = {
  fixtureHandle: string
  projectId: string
  chatId: string
  subChatId: string
  harness: string
  defaultVersion: number | null
  activitySeeded: boolean
  activityRuns: Array<[string, string]>
  continuations: Array<[string, string]>
  profiles: Array<[string, ProfileRef]>
  workflows: Array<[string, { workflowRunId: string; taskId: string; stepIds: string[] }]>
  workflowVersions: Array<[string, number]>
  standaloneLaunches: Array<[string, StandaloneOwnership]>
}

const persistedIdSchema = z.string().trim().min(1).max(512)
const persistedHandleSchema = (prefix: string) =>
  z.string().trim().min(1).max(200).startsWith(`${prefix}_`)
const persistedProfileRefSchema = z
  .object({
    profileId: persistedIdSchema,
    version: z.number().int().positive(),
    projectId: persistedIdSchema.nullable(),
  })
  .strict()
const persistedFixtureSchema: z.ZodType<PersistedFixture> = z
  .object({
    fixtureHandle: persistedHandleSchema("s4_fixture"),
    projectId: persistedIdSchema,
    chatId: persistedIdSchema,
    subChatId: persistedIdSchema,
    harness: persistedIdSchema.max(80),
    defaultVersion: z.number().int().positive().nullable(),
    activitySeeded: z.boolean(),
    activityRuns: z
      .array(z.tuple([persistedHandleSchema("s4_activity_run"), persistedIdSchema]))
      .max(100),
    continuations: z
      .array(z.tuple([persistedHandleSchema("s4_continuation"), persistedIdSchema]))
      .max(100),
    profiles: z
      .array(z.tuple([persistedHandleSchema("s4_profile"), persistedProfileRefSchema]))
      .max(500),
    workflows: z
      .array(
        z.tuple([
          persistedHandleSchema("s4_workflow"),
          z
            .object({
              workflowRunId: persistedIdSchema,
              taskId: persistedIdSchema,
              stepIds: z.array(persistedIdSchema).max(500),
            })
            .strict(),
        ]),
      )
      .max(100),
    workflowVersions: z
      .array(z.tuple([z.string().min(1).max(1_100), z.number().int().min(0)]))
      .max(500),
    standaloneLaunches: z
      .array(
        z.tuple([
          persistedHandleSchema("s4_launch"),
          z
            .object({
              launchId: persistedIdSchema,
              chatId: persistedIdSchema,
            })
            .strict(),
        ]),
      )
      .max(100),
  })
  .strict()
const persistedJournalSchema = z
  .object({
    schemaVersion: z.literal(1),
    fixtures: z.array(persistedFixtureSchema).max(MAX_PERSISTED_FIXTURES),
  })
  .strict()

function persistedFixture(fixtureHandle: string, fixture: Fixture): PersistedFixture {
  return {
    fixtureHandle,
    projectId: fixture.projectId,
    chatId: fixture.chatId,
    subChatId: fixture.subChatId,
    harness: fixture.harness,
    defaultVersion: fixture.defaultVersion,
    activitySeeded: fixture.activitySeeded,
    activityRuns: [...fixture.activityRuns],
    continuations: [...fixture.continuations],
    profiles: [...fixture.profiles],
    workflows: [...fixture.workflows].map(([handle, workflow]) => [
      handle,
      { ...workflow, stepIds: [...workflow.stepIds] },
    ]),
    workflowVersions: [...fixture.workflowVersions],
    standaloneLaunches: [...fixture.standaloneLaunches],
  }
}

function persistOwnership() {
  if (!journalPath) return
  if (fixtures.size === 0) {
    rmSync(journalPath, { force: true })
    return
  }
  const serialized = `${JSON.stringify({
    schemaVersion: 1,
    fixtures: [...fixtures].map(([handle, fixture]) => persistedFixture(handle, fixture)),
  })}\n`
  if (Buffer.byteLength(serialized) > MAX_JOURNAL_BYTES) {
    throw new Error("Stage 4 ownership journal exceeds its bounded size")
  }
  const temporaryPath = `${journalPath}.${process.pid}.tmp`
  writeFileSync(temporaryPath, serialized, { mode: 0o600 })
  renameSync(temporaryPath, journalPath)
  chmodSync(journalPath, 0o600)
}

function restoreFixture(value: PersistedFixture): Fixture {
  return {
    projectId: requiredString(value.projectId, "persisted projectId"),
    chatId: requiredString(value.chatId, "persisted chatId"),
    subChatId: requiredString(value.subChatId, "persisted subChatId"),
    harness: requiredString(value.harness, "persisted harness"),
    defaultVersion: Number.isInteger(value.defaultVersion) ? value.defaultVersion : null,
    activitySeeded: value.activitySeeded === true,
    activityRuns: new Map(value.activityRuns ?? []),
    continuations: new Map(value.continuations ?? []),
    profiles: new Map(value.profiles ?? []),
    bundles: new Map(),
    imports: new Map(),
    workflows: new Map(
      (value.workflows ?? []).map(([handle, workflow]) => [
        handle,
        { ...workflow, stepIds: new Set(workflow.stepIds ?? []) },
      ]),
    ),
    workflowVersions: new Map(value.workflowVersions ?? []),
    workflowBundles: new Map(),
    standalonePreviews: new Map(),
    standaloneLaunches: new Map(value.standaloneLaunches ?? []),
  }
}

export function configureStage4OwnershipJournal(userDataPath: string) {
  journalPath = join(userDataPath, JOURNAL_FILENAME)
  fixtures.clear()
  if (!existsSync(journalPath)) return
  if (statSync(journalPath).size > MAX_JOURNAL_BYTES) {
    throw new Error("Stage 4 ownership journal exceeds its bounded size")
  }
  const parsed = persistedJournalSchema.safeParse(JSON.parse(readFileSync(journalPath, "utf8")))
  if (!parsed.success) throw new Error("Stage 4 ownership journal is invalid")
  const document = parsed.data
  for (const persisted of document.fixtures) {
    fixtures.set(persisted.fixtureHandle, restoreFixture(persisted))
  }
}

export function simulateStage4OwnershipRestartForTests() {
  if (!journalPath) throw new Error("Stage 4 ownership journal is not configured")
  configureStage4OwnershipJournal(dirname(journalPath))
}
const fixtureProjects = new Map<string, string>()

function issueHandle(prefix: string) {
  return `${prefix}_${randomUUID()}`
}

function payload(value: unknown): Payload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Stage 4 control payload must be an object")
  }
  return value as Payload
}

function requiredString(value: unknown, name: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Stage 4 control requires ${name}`)
  }
  return value
}

function rejectRawKeys(input: Payload, keys: string[]) {
  const key = keys.find((candidate) => candidate in input)
  if (key) {
    throw new Error(`Stage 4 control rejects raw ${key}; use an issued fixture handle`)
  }
}

function fixtureFor(value: unknown) {
  const handle = requiredString(value, "fixtureHandle")
  const fixture = fixtures.get(handle)
  if (!fixture) throw new Error("Stage 4 fixture handle is invalid or expired")
  return { handle, fixture }
}

function owned<T>(map: Map<string, T>, value: unknown, label: string) {
  const handle = requiredString(value, `${label}Handle`)
  const result = map.get(handle)
  if (!result) throw new Error(`Stage 4 ${label} handle is invalid for this fixture`)
  return result
}

function profileResult(value: unknown) {
  if (!value || typeof value !== "object") return null
  const candidate = "profile" in value ? (value as { profile?: unknown }).profile : value
  if (!candidate || typeof candidate !== "object") return null
  const row = candidate as {
    id?: unknown
    currentVersion?: unknown
    scope?: { type?: unknown; projectId?: unknown }
  }
  if (typeof row.id !== "string" || !Number.isInteger(row.currentVersion)) return null
  const projectId =
    row.scope?.type === "project" && typeof row.scope.projectId === "string"
      ? row.scope.projectId
      : null
  return {
    profileId: row.id,
    version: row.currentVersion as number,
    projectId,
  }
}

function registerProfile(fixture: Fixture, value: unknown) {
  const ref = profileResult(value)
  if (!ref) throw new Error("Production profile service returned an invalid profile")
  const profileHandle = issueHandle("s4_profile")
  fixture.profiles.set(profileHandle, ref)
  persistOwnership()
  return profileHandle
}

function profileVersionRef(ref: ProfileRef) {
  return { profileId: ref.profileId, version: ref.version }
}

function standaloneResult(value: unknown): StandaloneOwnership | null {
  if (!value || typeof value !== "object") return null
  const row = value as { id?: unknown; chatId?: unknown }
  if (typeof row.id !== "string" || typeof row.chatId !== "string") return null
  return { launchId: row.id, chatId: row.chatId }
}

function decorateProfile(fixture: Fixture, value: unknown) {
  const profileHandle = registerProfile(fixture, value)
  if (!value || typeof value !== "object") return value
  if ("profile" in value) {
    return { ...(value as Payload), profileHandle }
  }
  return { ...(value as Payload), profileHandle }
}

function workflowKey(workflowRunId: string, stepId: string) {
  return `${workflowRunId}\u0000${stepId}`
}

function workflowTarget(fixture: Fixture, input: Payload, prefix = "") {
  const workflow = workflowOwned(fixture, input, prefix)
  const stepId = requiredString(input[`${prefix}stepId`], `${prefix}stepId`)
  if (!workflow.stepIds.has(stepId)) {
    throw new Error(`Stage 4 ${prefix}step does not belong to the owned workflow`)
  }
  return { workflowRunId: workflow.workflowRunId, stepId }
}

function workflowOwned(fixture: Fixture, input: Payload, prefix = "") {
  return owned(fixture.workflows, input[`${prefix}workflowHandle`], `${prefix}workflow`)
}

export function registerStage4Fixture(input: {
  projectId: string
  chatId: string
  subChatId: string
  harness: string
}) {
  if (fixtures.size >= MAX_PERSISTED_FIXTURES) {
    throw new Error("Stage 4 ownership journal has reached its fixture limit")
  }
  const fixtureHandle = issueHandle("s4_fixture")
  fixtures.set(fixtureHandle, {
    ...input,
    defaultVersion: null,
    activitySeeded: false,
    activityRuns: new Map(),
    continuations: new Map(),
    profiles: new Map(),
    bundles: new Map(),
    imports: new Map(),
    workflows: new Map(),
    workflowVersions: new Map(),
    workflowBundles: new Map(),
    standalonePreviews: new Map(),
    standaloneLaunches: new Map(),
  })
  persistOwnership()
  return fixtureHandle
}

export function registerStage4FixtureProject(input: {
  projectId: string
  projectPath: string
}): void {
  fixtureProjects.set(input.projectId, input.projectPath)
}

export function assertStage4FixtureProject(input: {
  projectId: string
  projectPath: string
}): void {
  if (fixtureProjects.get(input.projectId) !== input.projectPath) {
    throw new Error(
      "Stage 4 fixture creation requires the owned project created by ensure_test_project",
    )
  }
}

export function registerStage4FixtureWorkflows(
  fixtureHandle: string,
  workflows: Array<{ workflowRunId: string; taskId: string; stepIds: string[] }>,
) {
  const { fixture } = fixtureFor(fixtureHandle)
  const registered = workflows.map((workflow) => {
    const workflowHandle = issueHandle("s4_workflow")
    fixture.workflows.set(workflowHandle, {
      workflowRunId: workflow.workflowRunId,
      taskId: workflow.taskId,
      stepIds: new Set(workflow.stepIds),
    })
    return { workflowHandle, stepIds: workflow.stepIds }
  })
  persistOwnership()
  return registered
}

export function stage4FixtureIdentity(fixtureHandle: unknown) {
  return fixtureFor(fixtureHandle).fixture
}

export function getOwnedStage4RuntimeState(
  input: unknown,
  read: (input: {
    scope: { type: "project"; id: string }
    harness: string
    chatId: string
    runId?: string
    activityLimit?: number
  }) => unknown,
) {
  const request = payload(input)
  rejectRawKeys(request, ["scope", "harness", "projectId", "chatId", "subChatId", "runId"])
  const { fixture } = fixtureFor(request.fixtureHandle)
  const runId = request.activityRunHandle
    ? owned(fixture.activityRuns, request.activityRunHandle, "activityRun")
    : undefined
  return read({
    scope: { type: "project", id: fixture.projectId },
    harness: fixture.harness,
    chatId: fixture.chatId,
    ...(runId ? { runId } : {}),
    ...(typeof request.activityLimit === "number" ? { activityLimit: request.activityLimit } : {}),
  })
}

export function mutateOwnedStage4Runtime(
  input: { action: string; payload: unknown },
  mutate: (input: { action: string; payload: unknown }) => unknown,
  read: (input: {
    scope: { type: "project"; id: string }
    harness: string
    chatId: string
  }) => unknown,
) {
  const request = payload(input.payload)
  rejectRawKeys(request, [
    "scope",
    "harness",
    "projectId",
    "chatId",
    "subChatId",
    "sourceChatId",
    "targetChatId",
    "runId",
    "requestId",
    "expectedVersion",
  ])
  const { fixture } = fixtureFor(request.fixtureHandle)
  switch (input.action) {
    case "write-default": {
      if (fixture.defaultVersion === null) {
        const state = read({
          scope: { type: "project", id: fixture.projectId },
          harness: fixture.harness,
          chatId: fixture.chatId,
        }) as { defaults?: unknown[] }
        if ((state.defaults?.length ?? 0) > 0) {
          throw new Error("Stage 4 fixture does not own the existing Runtime default")
        }
      }
      const result = mutate({
        action: input.action,
        payload: {
          scope: { type: "project", id: fixture.projectId },
          harness: fixture.harness,
          preference: request.preference,
          expectedVersion: fixture.defaultVersion ?? 0,
        },
      }) as { version?: unknown }
      if (!Number.isInteger(result?.version)) {
        throw new Error("Production Runtime service returned an invalid version")
      }
      fixture.defaultVersion = result.version as number
      persistOwnership()
      return result
    }
    case "delete-default": {
      if (fixture.defaultVersion === null) {
        throw new Error("Stage 4 fixture does not own a Runtime default")
      }
      const result = mutate({
        action: input.action,
        payload: {
          scope: { type: "project", id: fixture.projectId },
          harness: fixture.harness,
          expectedVersion: fixture.defaultVersion,
        },
      })
      fixture.defaultVersion = null
      persistOwnership()
      return result
    }
    case "set-empty-chat":
      return mutate({
        action: input.action,
        payload: { chatId: fixture.chatId, preference: request.preference },
      })
    case "continue-chat": {
      const result = mutate({
        action: input.action,
        payload: {
          sourceChatId: fixture.chatId,
          preference: request.preference,
          requestId: issueHandle("s4_continue_request"),
          ...(typeof request.name === "string" ? { name: request.name } : {}),
        },
      }) as { chatId?: unknown }
      if (typeof result?.chatId !== "string") {
        throw new Error("Production Runtime service returned an invalid continuation")
      }
      const continuationHandle = issueHandle("s4_continuation")
      fixture.continuations.set(continuationHandle, result.chatId)
      persistOwnership()
      return { ...result, continuationHandle }
    }
    case "undo-continuation": {
      const continuationHandle = requiredString(request.continuationHandle, "continuationHandle")
      const targetChatId = owned(fixture.continuations, continuationHandle, "continuation")
      const result = mutate({
        action: input.action,
        payload: { sourceChatId: fixture.chatId, targetChatId },
      }) as { undone?: unknown }
      if (result?.undone === true) {
        fixture.continuations.delete(continuationHandle)
        persistOwnership()
      }
      return result
    }
    case "seed-activity": {
      const result = mutate({
        action: input.action,
        payload: {
          projectId: fixture.projectId,
          chatId: fixture.chatId,
          subChatId: fixture.subChatId,
        },
      }) as { runs?: Array<{ id?: unknown }> }
      const runs = Array.isArray(result?.runs) ? result.runs : []
      if (fixture.activitySeeded) {
        const handlesByRunId = new Map(
          [...fixture.activityRuns].map(([handle, runId]) => [runId, handle]),
        )
        const activityRunHandles = runs.map((run) => {
          if (typeof run.id !== "string") {
            throw new Error("Production activity fixture returned an invalid run")
          }
          const handle = handlesByRunId.get(run.id)
          if (!handle) {
            throw new Error("Production activity fixture retry changed its owned runs")
          }
          return handle
        })
        if (activityRunHandles.length !== fixture.activityRuns.size) {
          throw new Error("Production activity fixture retry returned incomplete owned runs")
        }
        return { ...result, activityRunHandles }
      }
      const activityRunHandles = runs.map((run) => {
        if (typeof run.id !== "string") {
          throw new Error("Production activity fixture returned an invalid run")
        }
        const activityRunHandle = issueHandle("s4_activity_run")
        fixture.activityRuns.set(activityRunHandle, run.id)
        return activityRunHandle
      })
      fixture.activitySeeded = true
      persistOwnership()
      return { ...result, activityRunHandles }
    }
    case "cleanup-activity": {
      if (!fixture.activitySeeded) {
        throw new Error("Stage 4 fixture does not own Runtime activity")
      }
      const result = mutate({
        action: input.action,
        payload: {
          projectId: fixture.projectId,
          chatId: fixture.chatId,
          subChatId: fixture.subChatId,
        },
      })
      fixture.activitySeeded = false
      fixture.activityRuns.clear()
      persistOwnership()
      return result
    }
    default:
      throw new Error("Unsupported Stage 4 Runtime action")
  }
}

export function getOwnedStage4ProfileState(
  input: { action: string; payload: unknown },
  read: (input: { action: string; payload: unknown }) => unknown,
) {
  const request = payload(input.payload)
  rejectRawKeys(request, [
    "profileId",
    "profile",
    "profiles",
    "projectId",
    "scope",
    "workflowRunId",
    "sourceWorkflowRunId",
    "targetWorkflowRunId",
    "launchId",
    "requestId",
    "source",
  ])
  const { fixture } = fixtureFor(request.fixtureHandle)
  switch (input.action) {
    case "list": {
      const result = read({
        action: input.action,
        payload: {
          projectId: fixture.projectId,
          ...(typeof request.query === "string" ? { query: request.query } : {}),
          ...(request.includeArchived === true ? { includeArchived: true } : {}),
        },
      })
      if (!Array.isArray(result)) throw new Error("Production profile list was invalid")
      const ownedProfileIds = new Set(
        [...fixture.profiles.values()].map((profile) => profile.profileId),
      )
      return result
        .filter(
          (profile) =>
            !!profile &&
            typeof profile === "object" &&
            ((profile as { source?: unknown }).source === "built-in" ||
              (typeof (profile as { id?: unknown }).id === "string" &&
                ownedProfileIds.has((profile as { id: string }).id))),
        )
        .map((profile) => decorateProfile(fixture, profile))
    }
    case "get": {
      const ref = owned(fixture.profiles, request.profileHandle, "profile")
      return read({ action: input.action, payload: profileVersionRef(ref) })
    }
    case "resolve": {
      const ref = owned(fixture.profiles, request.profileHandle, "profile")
      return read({
        action: input.action,
        payload: {
          profile: profileVersionRef(ref),
          overrides: request.overrides ?? null,
          policy: request.policy,
        },
      })
    }
    case "audit": {
      const ref = owned(fixture.profiles, request.profileHandle, "profile")
      return read({ action: input.action, payload: { profileId: ref.profileId } })
    }
    case "workflow-list": {
      const workflow = workflowOwned(fixture, request)
      return read({
        action: input.action,
        payload: { workflowRunId: workflow.workflowRunId },
      })
    }
    case "workflow-get":
    case "workflow-preview": {
      const target = workflowTarget(fixture, request)
      return read({ action: input.action, payload: target })
    }
    case "standalone-preview": {
      const ref = owned(fixture.profiles, request.profileHandle, "profile")
      const prior = request.launchHandle
        ? owned(fixture.standaloneLaunches, request.launchHandle, "launch")
        : null
      const current = prior
        ? (read({
            action: "standalone-get",
            payload: { launchId: prior.launchId },
          }) as {
            id?: unknown
            chatId?: unknown
            orchestrationTaskId?: unknown
            profile?: { profileId?: unknown; version?: unknown }
          })
        : null
      if (
        prior &&
        (current?.id !== prior.launchId ||
          current.chatId !== prior.chatId ||
          (current.profile?.profileId === ref.profileId && current.profile.version === ref.version))
      ) {
        throw new Error(
          current?.profile?.profileId === ref.profileId && current.profile.version === ref.version
            ? "Updated-profile continuation requires a different profile or newer version"
            : "Owned standalone launch relationship is invalid",
        )
      }
      const previewInput = {
        requestId: issueHandle("s4_standalone_request"),
        source: prior
          ? { kind: "chat", chatId: prior.chatId }
          : { kind: "studio", projectId: fixture.projectId },
        profile: profileVersionRef(ref),
        context: {
          includeTask: prior ? request.includeTask === true : false,
          includeParentChat: prior ? request.includeParentChat !== false : false,
        },
        overrides: request.overrides ?? null,
        orchestrationTaskId:
          prior && typeof current?.orchestrationTaskId === "string"
            ? current.orchestrationTaskId
            : null,
        confirmedSnapshotDigest: "0".repeat(64),
      }
      const result = read({ action: input.action, payload: previewInput }) as {
        digest?: unknown
      }
      if (typeof result?.digest !== "string") {
        throw new Error("Production standalone preview returned an invalid digest")
      }
      const previewHandle = issueHandle("s4_standalone_preview")
      fixture.standalonePreviews.set(previewHandle, {
        ...previewInput,
        confirmedSnapshotDigest: result.digest,
      })
      persistOwnership()
      return { ...result, previewHandle }
    }
    case "standalone-get": {
      const launchHandle = requiredString(request.launchHandle, "launchHandle")
      const launch = owned(fixture.standaloneLaunches, launchHandle, "launch")
      return read({ action: input.action, payload: { launchId: launch.launchId } })
    }
    default:
      throw new Error("Unsupported Stage 4 Profile read action")
  }
}

export async function mutateOwnedStage4Profile(
  input: { action: string; payload: unknown },
  mutate: (input: { action: string; payload: unknown }) => unknown | Promise<unknown>,
  read: (input: { action: string; payload: unknown }) => unknown,
) {
  const request = payload(input.payload)
  rejectRawKeys(request, [
    "profileId",
    "profile",
    "profiles",
    "projectId",
    "scope",
    "workflowRunId",
    "sourceWorkflowRunId",
    "targetWorkflowRunId",
    "launchId",
    "previewId",
    "expectedDigest",
    "bundle",
    "binding",
    "requestId",
    "source",
    "expectedVersion",
  ])
  const { fixture } = fixtureFor(request.fixtureHandle)
  switch (input.action) {
    case "ensure-starters": {
      const result = await mutate({ action: input.action, payload: {} })
      const profiles = read({
        action: "list",
        payload: { projectId: fixture.projectId },
      })
      if (!Array.isArray(profiles)) throw new Error("Production profile list was invalid")
      const starterProfileHandles = profiles
        .filter(
          (profile) =>
            !!profile &&
            typeof profile === "object" &&
            (profile as { source?: unknown }).source === "built-in",
        )
        .map((profile) => registerProfile(fixture, profile))
      return { ...(result as Payload), starterProfileHandles }
    }
    case "create": {
      const result = await mutate({
        action: input.action,
        payload: {
          name: request.name,
          description: request.description,
          category: request.category,
          definition: request.definition,
          scope: { type: "project", projectId: fixture.projectId },
        },
      })
      return decorateProfile(fixture, result)
    }
    case "update": {
      const profileHandle = requiredString(request.profileHandle, "profileHandle")
      const ref = owned(fixture.profiles, profileHandle, "profile")
      const result = await mutate({
        action: input.action,
        payload: {
          profileId: ref.profileId,
          expectedVersion: ref.version,
          identity: request.identity,
          definition: request.definition,
        },
      })
      const next = profileResult(result)
      if (!next || next.profileId !== ref.profileId) {
        throw new Error("Production profile update returned an invalid profile")
      }
      fixture.profiles.set(profileHandle, next)
      persistOwnership()
      return { ...(result as Payload), profileHandle }
    }
    case "duplicate": {
      const ref = owned(fixture.profiles, request.profileHandle, "profile")
      const result = await mutate({
        action: input.action,
        payload: {
          profile: profileVersionRef(ref),
          name: request.name,
          scope: { type: "project", projectId: fixture.projectId },
        },
      })
      return decorateProfile(fixture, result)
    }
    case "archive":
    case "restore": {
      const profileHandle = requiredString(request.profileHandle, "profileHandle")
      const ref = owned(fixture.profiles, profileHandle, "profile")
      const result = await mutate({
        action: input.action,
        payload: { profileId: ref.profileId, expectedVersion: ref.version },
      })
      const next = profileResult(result)
      if (next) {
        if (next.profileId !== ref.profileId) {
          throw new Error("Production profile archive returned an invalid profile")
        }
        fixture.profiles.set(profileHandle, next)
        persistOwnership()
      }
      return { ...(result as Payload), profileHandle }
    }
    case "export": {
      if (!Array.isArray(request.profileHandles) || request.profileHandles.length === 0) {
        throw new Error("Stage 4 profile export requires profileHandles")
      }
      const profiles = request.profileHandles.map((handle) =>
        profileVersionRef(owned(fixture.profiles, handle, "profile")),
      )
      const result = (await mutate({
        action: input.action,
        payload: { profiles },
      })) as { bundle?: unknown }
      if (typeof result?.bundle !== "string") {
        throw new Error("Production profile export returned an invalid bundle")
      }
      const bundleHandle = issueHandle("s4_profile_bundle")
      fixture.bundles.set(bundleHandle, result.bundle)
      persistOwnership()
      return { bundleHandle }
    }
    case "preview-import": {
      const bundle = owned(fixture.bundles, request.bundleHandle, "bundle")
      const result = (await mutate({
        action: input.action,
        payload: { bundle, sourceLabel: "Stage 4 owned MCP fixture" },
      })) as { previewId?: unknown; digest?: unknown }
      if (typeof result?.previewId !== "string" || typeof result.digest !== "string") {
        throw new Error("Production profile import preview was invalid")
      }
      const importHandle = issueHandle("s4_profile_import")
      fixture.imports.set(importHandle, {
        previewId: result.previewId,
        digest: result.digest,
      })
      persistOwnership()
      return { importHandle }
    }
    case "confirm-import": {
      const preview = owned(fixture.imports, request.importHandle, "import")
      const result = await mutate({
        action: input.action,
        payload: {
          previewId: preview.previewId,
          expectedDigest: preview.digest,
          conflict: request.conflict === "skip" ? "skip" : "duplicate",
          projectId: fixture.projectId,
        },
      })
      if (!Array.isArray(result)) throw new Error("Production profile import result was invalid")
      return result.map((profile) => decorateProfile(fixture, profile))
    }
    case "workflow-bind": {
      const target = workflowTarget(fixture, request)
      const ref = owned(fixture.profiles, request.profileHandle, "profile")
      const key = workflowKey(target.workflowRunId, target.stepId)
      const result = await mutate({
        action: input.action,
        payload: {
          binding: {
            schemaVersion: 1,
            ...target,
            profile: profileVersionRef(ref),
            workflowRole: request.workflowRole,
            inputSchema: request.inputSchema ?? null,
            outputSchema: request.outputSchema ?? null,
            overrides: request.overrides ?? null,
          },
          expectedVersion: fixture.workflowVersions.get(key) ?? 0,
        },
      })
      const version = (result as { version?: unknown })?.version
      if (!Number.isInteger(version)) throw new Error("Production workflow binding was invalid")
      fixture.workflowVersions.set(key, version as number)
      persistOwnership()
      return result
    }
    case "workflow-confirm": {
      const target = workflowTarget(fixture, request)
      const key = workflowKey(target.workflowRunId, target.stepId)
      const version = fixture.workflowVersions.get(key)
      if (!version) throw new Error("Stage 4 fixture does not own this workflow binding")
      return mutate({
        action: input.action,
        payload: { ...target, expectedVersion: version },
      })
    }
    case "workflow-fork": {
      const source = workflowTarget(fixture, request, "source")
      const target = workflowTarget(fixture, request, "target")
      const sourceKey = workflowKey(source.workflowRunId, source.stepId)
      if (!fixture.workflowVersions.has(sourceKey)) {
        throw new Error("Stage 4 fixture does not own the source workflow binding")
      }
      const ref = request.profileHandle
        ? owned(fixture.profiles, request.profileHandle, "profile")
        : undefined
      const result = await mutate({
        action: input.action,
        payload: {
          sourceWorkflowRunId: source.workflowRunId,
          sourceStepId: source.stepId,
          targetWorkflowRunId: target.workflowRunId,
          targetStepId: target.stepId,
          ...(ref ? { profile: profileVersionRef(ref) } : {}),
        },
      })
      const version = (result as { version?: unknown })?.version
      if (!Number.isInteger(version)) throw new Error("Production workflow fork was invalid")
      fixture.workflowVersions.set(
        workflowKey(target.workflowRunId, target.stepId),
        version as number,
      )
      persistOwnership()
      return result
    }
    case "workflow-export": {
      const target = workflowTarget(fixture, request)
      const key = workflowKey(target.workflowRunId, target.stepId)
      if (!fixture.workflowVersions.has(key)) {
        throw new Error("Stage 4 fixture does not own this workflow binding")
      }
      const result = (await mutate({
        action: input.action,
        payload: target,
      })) as { bundle?: unknown }
      if (typeof result?.bundle !== "string") {
        throw new Error("Production workflow export returned an invalid bundle")
      }
      const workflowBundleHandle = issueHandle("s4_workflow_bundle")
      fixture.workflowBundles.set(workflowBundleHandle, result.bundle)
      persistOwnership()
      return { workflowBundleHandle }
    }
    case "workflow-import": {
      const target = workflowTarget(fixture, request)
      const bundle = owned(fixture.workflowBundles, request.workflowBundleHandle, "workflowBundle")
      const key = workflowKey(target.workflowRunId, target.stepId)
      const result = await mutate({
        action: input.action,
        payload: {
          bundle,
          ...target,
          expectedVersion: fixture.workflowVersions.get(key) ?? 0,
        },
      })
      const version = (result as { version?: unknown })?.version
      if (!Number.isInteger(version)) throw new Error("Production workflow import was invalid")
      fixture.workflowVersions.set(key, version as number)
      persistOwnership()
      return result
    }
    case "standalone-launch": {
      const previewHandle = requiredString(request.previewHandle, "previewHandle")
      const preview = owned(fixture.standalonePreviews, previewHandle, "standalonePreview")
      const result = (await mutate({
        action: input.action,
        payload: preview,
      })) as { id?: unknown; chatId?: unknown }
      if (typeof result?.id !== "string" || typeof result.chatId !== "string") {
        throw new Error("Production standalone launch was invalid")
      }
      if (result.chatId === fixture.chatId) {
        throw new Error("Standalone launch chat must be distinct from its fixture chat")
      }
      const launchHandle = issueHandle("s4_launch")
      fixture.standaloneLaunches.set(launchHandle, {
        launchId: result.id,
        chatId: result.chatId,
      })
      fixture.standalonePreviews.delete(previewHandle)
      persistOwnership()
      return { ...result, launchHandle }
    }
    case "standalone-follow-up":
    case "standalone-retry": {
      const launchHandle = requiredString(request.launchHandle, "launchHandle")
      const launch = owned(fixture.standaloneLaunches, launchHandle, "launch")
      const result = await mutate({
        action: input.action,
        payload: {
          launchId: launch.launchId,
          requestId: issueHandle("s4_standalone_request"),
          ...(input.action === "standalone-follow-up"
            ? { prompt: requiredString(request.prompt, "prompt") }
            : {}),
        },
      })
      const next = standaloneResult(result)
      if (!next || next.chatId !== launch.chatId || next.launchId === launch.launchId) {
        throw new Error("Production standalone follow-on launch was invalid")
      }
      fixture.standaloneLaunches.set(launchHandle, next)
      persistOwnership()
      return { ...(result as Payload), launchHandle }
    }
    case "standalone-continue-with-updated-profile": {
      const previousLaunchHandle = requiredString(request.launchHandle, "launchHandle")
      const prior = owned(fixture.standaloneLaunches, previousLaunchHandle, "launch")
      const previewHandle = requiredString(request.previewHandle, "previewHandle")
      const preview = owned(fixture.standalonePreviews, previewHandle, "standalonePreview")
      const source = payload(preview.source)
      if (source.kind !== "chat" || source.chatId !== prior.chatId) {
        throw new Error("Updated-profile preview does not belong to the owned standalone launch")
      }
      const result = await mutate({
        action: input.action,
        payload: { launchId: prior.launchId, launch: preview },
      })
      const next = standaloneResult(result)
      if (!next || next.chatId === prior.chatId || next.launchId === prior.launchId) {
        throw new Error("Production updated-profile continuation was invalid")
      }
      const launchHandle = issueHandle("s4_launch")
      fixture.standaloneLaunches.set(launchHandle, next)
      fixture.standalonePreviews.delete(previewHandle)
      persistOwnership()
      return { ...(result as Payload), previousLaunchHandle, launchHandle }
    }
    case "standalone-stop": {
      const launchHandle = requiredString(request.launchHandle, "launchHandle")
      const launch = owned(fixture.standaloneLaunches, request.launchHandle, "launch")
      const result = await mutate({
        action: input.action,
        payload: {
          launchId: launch.launchId,
          reason:
            typeof request.reason === "string"
              ? request.reason
              : "stage4-owned-test-control-cleanup",
        },
      })
      return { ...(result as Payload), launchHandle }
    }
    default:
      throw new Error("Unsupported Stage 4 Profile mutation action")
  }
}

export async function cleanupPersistedStage4Ownership(adapters: {
  mutateRuntime: (input: { action: string; payload: unknown }) => unknown
  readRuntime: (input: {
    scope: { type: "project"; id: string }
    harness: string
    chatId: string
  }) => unknown
  mutateProfile: (input: { action: string; payload: unknown }) => unknown | Promise<unknown>
  profileStatus: (profileId: string) => {
    missing: boolean
    archived: boolean
    currentVersion: number | null
    projectId: string | null
  }
  fixtureRelationshipValid: (input: {
    projectId: string
    chatId: string
    subChatId: string
  }) => boolean
  continuationRelationshipValid: (input: {
    projectId: string
    sourceChatId: string
    targetChatId: string
  }) => boolean
  standaloneRelationshipValid: (input: {
    projectId: string
    launchId: string
    chatId: string
  }) => boolean
  workflowRelationshipValid: (input: {
    projectId: string
    initiatingChatId: string
    taskId: string
    workflowRunId: string
  }) => boolean
  launchMissing: (launchId: string) => boolean
  chatMissingOrArchived: (chatId: string) => boolean
  taskMissingOrArchived: (taskId: string) => boolean
  archiveChat: (chatId: string) => unknown
  archiveTask: (taskId: string) => unknown
}) {
  const errors: Array<{ operation: string; message: string }> = []
  let inspectedFixtures = 0
  let cleanedFixtures = 0
  let cleanedResources = 0
  const attempt = async (operation: string, work: () => unknown | Promise<unknown>) => {
    try {
      await work()
      cleanedResources += 1
      return true
    } catch (error) {
      errors.push({
        operation,
        message: error instanceof Error ? error.message : String(error),
      })
      return false
    }
  }

  for (const [fixtureHandle, fixture] of [...fixtures].slice(0, MAX_PERSISTED_FIXTURES)) {
    inspectedFixtures += 1
    const fixtureErrorsBefore = errors.length
    if (
      !adapters.fixtureRelationshipValid({
        projectId: fixture.projectId,
        chatId: fixture.chatId,
        subChatId: fixture.subChatId,
      })
    ) {
      errors.push({
        operation: "validate-fixture-relationship",
        message: "Persisted fixture relationship does not match current data",
      })
      persistOwnership()
      continue
    }
    for (const [launchHandle, launch] of [...fixture.standaloneLaunches]) {
      await attempt("stop-standalone", async () => {
        if (!launch.launchId || !launch.chatId || launch.chatId === fixture.chatId) {
          throw new Error("Standalone ownership relationship is invalid")
        }
        if (
          !adapters.standaloneRelationshipValid({
            projectId: fixture.projectId,
            launchId: launch.launchId,
            chatId: launch.chatId,
          })
        ) {
          if (
            adapters.launchMissing(launch.launchId) &&
            adapters.chatMissingOrArchived(launch.chatId)
          ) {
            fixture.standaloneLaunches.delete(launchHandle)
            return
          }
          throw new Error("Standalone ownership relationship does not match current data")
        }
        try {
          const result = (await adapters.mutateProfile({
            action: "standalone-stop",
            payload: {
              launchId: launch.launchId,
              reason: "stage4-persisted-ownership-recovery",
            },
          })) as { stopped?: unknown }
          if (result?.stopped !== true && !adapters.launchMissing(launch.launchId)) {
            throw new Error("Standalone stop did not confirm success")
          }
        } catch (error) {
          if (!adapters.launchMissing(launch.launchId)) throw error
        }
        if (!adapters.chatMissingOrArchived(launch.chatId)) {
          adapters.archiveChat(launch.chatId)
        }
        fixture.standaloneLaunches.delete(launchHandle)
      })
    }

    for (const [continuationHandle, targetChatId] of [...fixture.continuations]) {
      await attempt("undo-continuation", () => {
        if (!targetChatId || targetChatId === fixture.chatId) {
          throw new Error("Continuation ownership relationship is invalid")
        }
        if (adapters.chatMissingOrArchived(targetChatId)) {
          fixture.continuations.delete(continuationHandle)
          return
        }
        if (
          !adapters.continuationRelationshipValid({
            projectId: fixture.projectId,
            sourceChatId: fixture.chatId,
            targetChatId,
          })
        ) {
          throw new Error("Continuation ownership relationship does not match current data")
        }
        const result = adapters.mutateRuntime({
          action: "undo-continuation",
          payload: { sourceChatId: fixture.chatId, targetChatId },
        }) as { undone?: unknown }
        if (result?.undone !== true && !adapters.chatMissingOrArchived(targetChatId)) {
          throw new Error("Continuation undo did not confirm success")
        }
        fixture.continuations.delete(continuationHandle)
      })
    }

    if (fixture.activitySeeded) {
      await attempt("cleanup-activity", () => {
        adapters.mutateRuntime({
          action: "cleanup-activity",
          payload: {
            projectId: fixture.projectId,
            chatId: fixture.chatId,
            subChatId: fixture.subChatId,
          },
        })
        fixture.activitySeeded = false
        fixture.activityRuns.clear()
      })
    }

    for (const [profileHandle, ref] of [...fixture.profiles]) {
      if (ref.profileId.startsWith("builtin.")) continue
      await attempt("archive-profile", async () => {
        if (ref.projectId !== fixture.projectId) {
          throw new Error("Profile ownership relationship is invalid")
        }
        const status = adapters.profileStatus(ref.profileId)
        if (status.missing || status.archived) {
          fixture.profiles.delete(profileHandle)
          return
        }
        if (status.projectId !== fixture.projectId) {
          throw new Error("Profile ownership relationship does not match current data")
        }
        if (!status.currentVersion) throw new Error("Owned profile version is unavailable")
        ref.version = status.currentVersion
        await adapters.mutateProfile({
          action: "archive",
          payload: { profileId: ref.profileId, expectedVersion: ref.version },
        })
        fixture.profiles.delete(profileHandle)
      })
    }

    if (fixture.defaultVersion !== null) {
      await attempt("delete-runtime-default", () => {
        const state = adapters.readRuntime({
          scope: { type: "project", id: fixture.projectId },
          harness: fixture.harness,
          chatId: fixture.chatId,
        }) as { defaults?: Array<{ version?: unknown }> }
        const current = state.defaults?.[0]
        if (current) {
          if (current.version !== fixture.defaultVersion) {
            throw new Error("Owned Runtime default version changed outside its fixture")
          }
          adapters.mutateRuntime({
            action: "delete-default",
            payload: {
              scope: { type: "project", id: fixture.projectId },
              harness: fixture.harness,
              expectedVersion: fixture.defaultVersion,
            },
          })
        }
        fixture.defaultVersion = null
      })
    }

    if (fixture.continuations.size === 0) {
      const taskIds = new Set([...fixture.workflows.values()].map((workflow) => workflow.taskId))
      for (const taskId of taskIds) {
        await attempt("archive-workflow-task", () => {
          if (adapters.taskMissingOrArchived(taskId)) {
            for (const [workflowHandle, workflow] of fixture.workflows) {
              if (workflow.taskId === taskId) fixture.workflows.delete(workflowHandle)
            }
            return
          }
          const workflows = [...fixture.workflows.values()].filter(
            (workflow) => workflow.taskId === taskId,
          )
          if (
            workflows.length === 0 ||
            workflows.some(
              (workflow) =>
                !adapters.workflowRelationshipValid({
                  projectId: fixture.projectId,
                  initiatingChatId: fixture.chatId,
                  taskId,
                  workflowRunId: workflow.workflowRunId,
                }),
            )
          ) {
            throw new Error("Workflow ownership relationship does not match current data")
          }
          adapters.archiveTask(taskId)
          for (const [workflowHandle, workflow] of fixture.workflows) {
            if (workflow.taskId === taskId) fixture.workflows.delete(workflowHandle)
          }
        })
      }

      await attempt("archive-fixture-chat", () => {
        if (!adapters.chatMissingOrArchived(fixture.chatId)) adapters.archiveChat(fixture.chatId)
      })
    }

    if (errors.length === fixtureErrorsBefore) {
      fixtures.delete(fixtureHandle)
      cleanedFixtures += 1
    }
    persistOwnership()
  }
  return {
    inspectedFixtures,
    cleanedFixtures,
    remainingFixtures: fixtures.size,
    cleanedResources,
    errors,
  }
}

export function resetStage4OwnershipForTests() {
  fixtures.clear()
  fixtureProjects.clear()
  journalPath = null
}
