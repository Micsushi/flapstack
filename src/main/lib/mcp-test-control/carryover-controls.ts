import { randomUUID } from "node:crypto"
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, dirname, join } from "node:path"
import { eq, inArray } from "drizzle-orm"
import simpleGit from "simple-git"
import { captureCheckpoint, captureRunManifest } from "../checkpoints"
import {
  agentRuns,
  chats,
  filesystemRootRegistrations,
  getDatabase,
  projects,
  subChats,
  usageAlertEvents,
  usageCycles,
  usageProviderStates,
  usageSamples,
  voiceArtifacts,
} from "../db"
import { bindRegisteredFilesystemRoot } from "../git/security/path-validation"
import { getRunChangeReview, getRunChangeSet, undoRunChangeSet } from "../run-change-undo"
import { getUsageProviders } from "../usage/registry"
import { runManualRefresh } from "../usage/catch-up"
import { getAppUsageSecret } from "../usage/app-secrets"
import { hasUsageSecret } from "../usage/secrets"
import { getUsageSettings } from "../usage/settings"
import { insertSamples, listCurrentSamples, listProviderStates } from "../usage/store"
import { readDaemonStatus } from "../usage-daemon/lifecycle"
import { searchVoiceHistory } from "../speech/history"
import { deleteVoiceHistoryEntry, recordTranscription } from "../speech/history"
import {
  getNativeTtsAvailability,
  resolveSttAdapter,
  resolveTtsAdapter,
  sttAdapterImplementations,
  ttsAdapterImplementations,
} from "../speech/registry"
import { getVoiceSettings, setVoiceSettings } from "../speech/settings"
import { getParakeetModelStatus, parakeetSidecar } from "../speech/stt-parakeet-streaming"
import { getSttModelStatus } from "../speech/stt-whisper-cpp"
import type { VoiceSettings } from "../speech/types"
import type { UsageProviderId } from "../usage/types"

const DEV_USAGE_UI_ACCOUNT_TAG_PREFIX = "dev-stage3-ui-fixture-"
export const DEV_VOICE_UI_ORIGIN = "Stage 3 Voice UI fixture"
export const DEV_VOICE_UI_TEXT = "Stage 3 voice history fixture"
const DEV_VOICE_UI_ORIGIN_ID = "stage3-voice-ui-fixture"
const activeVoiceUiFixtureIds = new Set<string>()

type UsageUiFixtureState = {
  accountTag: string
  sampleIds: string[]
  cycleIds: string[]
  alertIds: string[]
  providerStateIds: string[]
}

let activeUsageUiFixture: UsageUiFixtureState | null = null

function silentWav(durationMs = 100) {
  const sampleCount = Math.max(1, Math.round((16_000 * durationMs) / 1_000))
  const output = Buffer.alloc(44 + sampleCount * 2)
  output.write("RIFF", 0)
  output.writeUInt32LE(36 + sampleCount * 2, 4)
  output.write("WAVEfmt ", 8)
  output.writeUInt32LE(16, 16)
  output.writeUInt16LE(1, 20)
  output.writeUInt16LE(1, 22)
  output.writeUInt32LE(16_000, 24)
  output.writeUInt32LE(32_000, 28)
  output.writeUInt16LE(2, 32)
  output.writeUInt16LE(16, 34)
  output.write("data", 36)
  output.writeUInt32LE(sampleCount * 2, 40)
  return output
}

function usageDeps() {
  return { db: getDatabase(), getSecret: getAppUsageSecret }
}

async function safeProbe<T>(probe: () => Promise<T>) {
  try {
    return { ok: true as const, value: await probe() }
  } catch (error) {
    return {
      ok: false as const,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export async function getVoiceState() {
  const settings = getVoiceSettings()
  const [sttAvailability, ttsAvailability, parakeetModel, whisperModel] = await Promise.all([
    Promise.all(
      sttAdapterImplementations.map(
        async (adapter) => [adapter.id, await safeProbe(() => adapter.isAvailable())] as const,
      ),
    ),
    Promise.all(
      ttsAdapterImplementations.map(
        async (adapter) => [adapter.id, await safeProbe(() => adapter.isAvailable())] as const,
      ),
    ),
    safeProbe(() => getParakeetModelStatus()),
    safeProbe(() => getSttModelStatus(settings.whisperModelId)),
  ])
  const history = searchVoiceHistory("")
  return {
    settings,
    selected: {
      sttAdapterId: resolveSttAdapter(settings).id,
      ttsAdapterId: resolveTtsAdapter(settings).id,
    },
    availability: {
      nativeTts: getNativeTtsAvailability(),
      stt: Object.fromEntries(sttAvailability),
      tts: Object.fromEntries(ttsAvailability),
    },
    models: { parakeet: parakeetModel, whisper: whisperModel },
    history: {
      count: history.length,
      transcriptionCount: history.filter((entry) => entry.kind === "transcription").length,
      speechCount: history.filter((entry) => entry.kind === "speech").length,
      withAudioCount: history.filter((entry) => Boolean(entry.audioPath)).length,
    },
  }
}

export function controlVoiceSettings(
  input: Partial<
    Pick<
      VoiceSettings,
      | "sttAdapterId"
      | "retainDictationAudio"
      | "sttModelUnloadMinutes"
      | "whisperModelId"
      | "ttsAdapterId"
      | "voiceId"
      | "voiceByTtsAdapterId"
      | "rate"
      | "preferOffline"
    >
  >,
) {
  const previous = getVoiceSettings()
  const next = setVoiceSettings(input)
  if (previous.sttModelUnloadMinutes !== next.sttModelUnloadMinutes) {
    parakeetSidecar.rescheduleIdleUnload()
  }
  return next
}

export async function createVoiceUiFixture() {
  const artifact = await recordTranscription({
    text: DEV_VOICE_UI_TEXT,
    adapterId: "local-parakeet",
    modelId: "parakeet-unified-en-q8",
    originKind: "new-chat",
    originId: DEV_VOICE_UI_ORIGIN_ID,
    originLabel: DEV_VOICE_UI_ORIGIN,
    durationMs: 100,
    audioWav: silentWav(),
  })
  activeVoiceUiFixtureIds.add(artifact.id)
  return { id: artifact.id, kind: artifact.kind, hasAudio: Boolean(artifact.audioPath) }
}

export function requireVoiceUiFixture(id: string) {
  const artifact = getDatabase()
    .select()
    .from(voiceArtifacts)
    .where(eq(voiceArtifacts.id, id))
    .get()
  if (
    !artifact ||
    !activeVoiceUiFixtureIds.has(id) ||
    artifact.originId !== DEV_VOICE_UI_ORIGIN_ID ||
    artifact.originLabel !== DEV_VOICE_UI_ORIGIN
  ) {
    throw new Error("Voice UI control requires an exact Stage 3 fixture")
  }
  return { id: artifact.id, kind: artifact.kind, hasAudio: Boolean(artifact.audioPath) }
}

export async function cleanupVoiceUiFixture(input: { id: string }) {
  const artifact = getDatabase()
    .select()
    .from(voiceArtifacts)
    .where(eq(voiceArtifacts.id, input.id))
    .get()
  if (!artifact) return { deleted: false, alreadyMissing: true, id: input.id }
  requireVoiceUiFixture(input.id)
  const result = await deleteVoiceHistoryEntry(input.id)
  activeVoiceUiFixtureIds.delete(input.id)
  return { ...result, alreadyMissing: false, id: input.id }
}

export async function getUsageState() {
  const db = getDatabase()
  const [states, samples, daemon, openrouterKey, nanogptKey] = await Promise.all([
    listProviderStates(db),
    listCurrentSamples(db, { limitPerAccount: 25 }),
    readDaemonStatus(db),
    getAppUsageSecret("openrouter.api_key"),
    getAppUsageSecret("nanogpt.api_key"),
  ])
  return {
    settings: getUsageSettings(),
    providers: getUsageProviders().map((provider) => ({
      id: provider.id,
      label: provider.label,
      billingKind: provider.billingKind,
      supportsDaemon: provider.supportsDaemon(),
      supportsHistorical: provider.supportsHistorical(),
    })),
    credentials: {
      openai: hasUsageSecret("openai.api_key"),
      anthropic: hasUsageSecret("anthropic.admin_key"),
      cursorApiKey: hasUsageSecret("cursor.api_key"),
      cursorAccessToken: hasUsageSecret("cursor.access_token"),
      openrouter: openrouterKey != null,
      nanogpt: nanogptKey != null,
    },
    states,
    currentSamples: samples.map(
      ({ rawPayload: _rawPayload, dedupeKey: _dedupeKey, ...sample }) => sample,
    ),
    daemon,
  }
}

export function refreshUsageState(input: { providerId?: UsageProviderId }) {
  return runManualRefresh(usageDeps(), input.providerId)
}

export async function getRunChangeState(input: {
  runId: string
  includeReview?: boolean
  filePath?: string
}) {
  if (input.includeReview || input.filePath) {
    return getRunChangeReview(input.runId, input.filePath)
  }
  return getRunChangeSet(input.runId)
}

export function undoRunChange(input: { runId: string }) {
  return undoRunChangeSet(input.runId)
}

export async function createCarryoverRunFixture(input: {
  laterEdit?: "none" | "non-overlap" | "overlap"
}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "flapstack-carryover-run-")))
  const git = simpleGit(root)
  let projectId: string | undefined
  try {
    await git.init()
    await git.addConfig("user.name", "Flapstack Dev Fixture")
    await git.addConfig("user.email", "dev-fixture@flapstack.local")
    await writeFile(join(root, "alpha.txt"), "alpha before\nmanual anchor\nomega before\n")
    await writeFile(join(root, "beta.txt"), "beta before\n")
    await git.add(["alpha.txt", "beta.txt"])
    await git.commit("Initialize carryover fixture")

    const db = getDatabase()
    // The product exposes one canonical conversation per sidebar chat. Keep the
    // primary evidence row strictly earlier than the legacy background row so
    // second-resolution SQLite timestamps cannot make canonical selection depend
    // on generated IDs.
    const primaryCreatedAt = new Date(Date.now() - 2_000)
    const backgroundCreatedAt = new Date(Date.now() - 1_000)
    const created = db.transaction((tx) => {
      const project = tx
        .insert(projects)
        .values({ name: "Carryover run fixture", path: root })
        .returning()
        .get()
      const chat = tx
        .insert(chats)
        .values({
          name: "Carryover run fixture",
          projectId: project.id,
          scope: "project",
          harness: "codex",
          model: "gpt-5.5",
          permissionMode: "read-only",
          worktreePath: root,
          ancestorChatIds: "[]",
        })
        .returning()
        .get()
      tx.update(chats).set({ initiatorChatId: chat.id }).where(eq(chats.id, chat.id)).run()
      const subChat = tx
        .insert(subChats)
        .values({
          chatId: chat.id,
          name: chat.name,
          mode: "agent",
          harness: "codex",
          model: "gpt-5.5",
          permissionMode: "read-only",
          worktreePath: root,
          messages: "[]",
          createdAt: primaryCreatedAt,
          updatedAt: primaryCreatedAt,
        })
        .returning()
        .get()
      const backgroundSubChat = tx
        .insert(subChats)
        .values({
          chatId: chat.id,
          name: "Background input fixture",
          mode: "agent",
          harness: "codex",
          model: "gpt-5.5",
          permissionMode: "read-only",
          worktreePath: root,
          messages: "[]",
          createdAt: backgroundCreatedAt,
          updatedAt: backgroundCreatedAt,
        })
        .returning()
        .get()
      const run = tx
        .insert(agentRuns)
        .values({
          chatId: chat.id,
          subChatId: subChat.id,
          harness: "codex",
          model: "gpt-5.5",
          permissionMode: "read-only",
          worktreePath: root,
          status: "running",
        })
        .returning()
        .get()
      return { project, chat, subChat, backgroundSubChat, run }
    })
    projectId = created.project.id
    bindRegisteredFilesystemRoot(root)

    const before = await captureCheckpoint(created.run.id, root, "before")
    db.update(agentRuns)
      .set({ beforeCheckpointId: before.id })
      .where(eq(agentRuns.id, created.run.id))
      .run()
    await writeFile(join(root, "alpha.txt"), "alpha from response\nmanual anchor\nomega before\n")
    await writeFile(join(root, "beta.txt"), "beta from response\n")
    const after = await captureCheckpoint(created.run.id, root, "after")
    await captureRunManifest(created.run.id)
    db.update(agentRuns)
      .set({ status: "success", afterCheckpointId: after.id, completedAt: new Date() })
      .where(eq(agentRuns.id, created.run.id))
      .run()

    const laterEdit = input.laterEdit ?? "none"
    if (laterEdit === "non-overlap") {
      await writeFile(
        join(root, "alpha.txt"),
        "alpha from response\nmanual anchor\nomega from later manual edit\n",
      )
    } else if (laterEdit === "overlap") {
      await writeFile(
        join(root, "alpha.txt"),
        "alpha from overlapping later edit\nmanual anchor\nomega before\n",
      )
    }

    const now = Date.now()
    const reasoningStartedAt = now - 2_500
    const messages = [
      {
        id: `fixture-user-${created.run.id}`,
        role: "user",
        createdAt: new Date(now - 86_400_000).toISOString(),
        parts: [{ type: "text", text: "Create the bounded carryover fixture." }],
      },
      {
        id: `fixture-assistant-${created.run.id}`,
        role: "assistant",
        createdAt: new Date(now).toISOString(),
        parts: [
          {
            type: "reasoning",
            state: "done",
            label: "Reasoning summary",
            text: "Fixture-only visible reasoning for disclosure verification.",
          },
          { type: "text", text: "Fixture changed two files." },
        ],
        metadata: {
          runId: created.run.id,
          reasoningStartedAt,
          reasoningDurationMs: 2_500,
        },
      },
    ]
    db.update(subChats)
      .set({ messages: JSON.stringify(messages), updatedAt: new Date() })
      .where(eq(subChats.id, created.subChat.id))
      .run()

    return {
      projectId: created.project.id,
      chatId: created.chat.id,
      subChatId: created.subChat.id,
      backgroundSubChatId: created.backgroundSubChat.id,
      runId: created.run.id,
      laterEdit,
      expected: {
        fileCount: 2,
        undoSuccess: laterEdit !== "overlap",
        preservesNonOverlap: laterEdit === "non-overlap",
        blocksOverlap: laterEdit === "overlap",
      },
    }
  } catch (error) {
    if (projectId) {
      const db = getDatabase()
      const cleanupProjectId = projectId
      db.transaction((tx) => {
        tx.delete(projects).where(eq(projects.id, cleanupProjectId)).run()
        tx.delete(filesystemRootRegistrations)
          .where(eq(filesystemRootRegistrations.path, root))
          .run()
      })
    }
    await rm(root, { recursive: true, force: true })
    throw error
  }
}

export async function getCarryoverRunFixtureFiles(input: { projectId: string }) {
  const project = getDatabase()
    .select({ name: projects.name, path: projects.path })
    .from(projects)
    .where(eq(projects.id, input.projectId))
    .get()
  const tempRoot = await realpath(tmpdir())
  if (
    !project ||
    project.name !== "Carryover run fixture" ||
    dirname(project.path) !== tempRoot ||
    basename(project.path).startsWith("flapstack-carryover-run-") === false
  ) {
    throw new Error("Carryover run fixture not found")
  }
  return {
    alpha: await readFile(join(project.path, "alpha.txt"), "utf8"),
    beta: await readFile(join(project.path, "beta.txt"), "utf8"),
  }
}

export async function cleanupCarryoverRunFixture(input: { projectId: string }) {
  const db = getDatabase()
  const project = db
    .select({ name: projects.name, path: projects.path })
    .from(projects)
    .where(eq(projects.id, input.projectId))
    .get()
  const tempRoot = await realpath(tmpdir())
  if (
    !project ||
    project.name !== "Carryover run fixture" ||
    dirname(project.path) !== tempRoot ||
    basename(project.path).startsWith("flapstack-carryover-run-") === false
  ) {
    throw new Error("Carryover run fixture not found")
  }
  db.transaction((tx) => {
    tx.delete(projects).where(eq(projects.id, input.projectId)).run()
    tx.delete(filesystemRootRegistrations)
      .where(eq(filesystemRootRegistrations.path, project.path))
      .run()
  })
  await rm(project.path, { recursive: true, force: true })
  return { cleaned: true, projectId: input.projectId }
}

export async function createUsageUiFixture() {
  cleanupUsageUiFixture()
  const db = getDatabase()
  const now = Date.now()
  const fixtureToken = randomUUID()
  const accountTag = `${DEV_USAGE_UI_ACCOUNT_TAG_PREFIX}${fixtureToken}`
  await insertSamples(
    db,
    Array.from({ length: 30 }, (_, index) => {
      const capturedAt = new Date(now - index * 4 * 60 * 60 * 1_000)
      const windowStart = new Date(capturedAt.getTime() - 5 * 60 * 60 * 1_000)
      return {
        providerId: "codex" as const,
        accountTag,
        source: "app-poll" as const,
        costQuality: "provider-reported" as const,
        sourceTag: `dev-fixture:${fixtureToken}`,
        metricKey: "five_hour",
        capturedAt,
        windowStart,
        windowEnd: capturedAt,
        inputTokens: 1_000 + index * 10,
        outputTokens: 250 + index * 5,
        totalTokens: 1_250 + index * 15,
        requestCount: index + 1,
        costUsd: 0.1 + index / 100,
        percentUsed: Math.min(99, 20 + index * 2),
        quotaUsed: 20 + index * 2,
        quotaLimit: 100,
        quotaUnit: "provider-native" as const,
        resetAt: new Date(capturedAt.getTime() + 60 * 60 * 1_000),
        dedupeKey: `dev-stage3-ui-sample-${fixtureToken}-${index}`,
      }
    }),
  )
  db.insert(usageProviderStates)
    .values([
      {
        providerId: "codex",
        accountTag,
        status: "ok",
        statusDetail: "Sanitized Stage 3 UI fixture",
        configured: true,
        supportsDaemon: true,
        supportsHistorical: true,
        lastPollAt: new Date(now),
        lastSuccessAt: new Date(now),
      },
      {
        providerId: "nanogpt",
        accountTag,
        status: "run-usage-only",
        statusDetail: "Run usage only; account history is unavailable.",
        configured: true,
        supportsDaemon: false,
        supportsHistorical: false,
        lastPollAt: new Date(now),
        lastSuccessAt: new Date(now),
      },
    ])
    .run()
  db.insert(usageAlertEvents)
    .values(
      Array.from({ length: 30 }, (_, index) => ({
        providerId: "codex",
        accountTag,
        alertType: index % 2 === 0 ? "quota-percent" : "api-dollar-budget",
        thresholdValue: 50_000_000,
        observedValue: 70_000_000 + index,
        costQuality: "provider-reported",
        channel: "discord",
        deliveryStatus: index === 0 ? "failed" : "sent",
        deliveryError: index === 0 ? "Sanitized fixture delivery failure" : null,
        message: `Sanitized Stage 3 alert fixture ${index + 1}`,
        createdAt: new Date(now - index * 60_000),
      })),
    )
    .run()
  activeUsageUiFixture = {
    accountTag,
    sampleIds: db
      .select({ id: usageSamples.id })
      .from(usageSamples)
      .where(eq(usageSamples.accountTag, accountTag))
      .all()
      .map((row) => row.id),
    cycleIds: db
      .select({ id: usageCycles.id })
      .from(usageCycles)
      .where(eq(usageCycles.accountTag, accountTag))
      .all()
      .map((row) => row.id),
    alertIds: db
      .select({ id: usageAlertEvents.id })
      .from(usageAlertEvents)
      .where(eq(usageAlertEvents.accountTag, accountTag))
      .all()
      .map((row) => row.id),
    providerStateIds: db
      .select({ id: usageProviderStates.id })
      .from(usageProviderStates)
      .where(eq(usageProviderStates.accountTag, accountTag))
      .all()
      .map((row) => row.id),
  }
  return {
    accountTag,
    samples: 30,
    cycles: 30,
    alerts: 30,
    providerStates: 2,
  }
}

export function cleanupUsageUiFixture() {
  const fixture = activeUsageUiFixture
  if (!fixture) {
    return { accountTag: null, alerts: 0, cycles: 0, samples: 0, providerStates: 0 }
  }
  const db = getDatabase()
  const result = db.transaction((tx) => ({
    alerts:
      fixture.alertIds.length === 0
        ? 0
        : tx.delete(usageAlertEvents).where(inArray(usageAlertEvents.id, fixture.alertIds)).run()
            .changes,
    cycles:
      fixture.cycleIds.length === 0
        ? 0
        : tx.delete(usageCycles).where(inArray(usageCycles.id, fixture.cycleIds)).run().changes,
    samples:
      fixture.sampleIds.length === 0
        ? 0
        : tx.delete(usageSamples).where(inArray(usageSamples.id, fixture.sampleIds)).run().changes,
    providerStates:
      fixture.providerStateIds.length === 0
        ? 0
        : tx
            .delete(usageProviderStates)
            .where(inArray(usageProviderStates.id, fixture.providerStateIds))
            .run().changes,
  }))
  activeUsageUiFixture = null
  return { accountTag: fixture.accountTag, ...result }
}
