import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, dirname, join } from "node:path"
import { eq } from "drizzle-orm"
import simpleGit from "simple-git"
import { captureCheckpoint, captureRunManifest } from "../checkpoints"
import {
  agentRuns,
  chats,
  filesystemRootRegistrations,
  getDatabase,
  projects,
  subChats,
} from "../db"
import { bindRegisteredFilesystemRoot } from "../git/security/path-validation"
import { getRunChangeReview, getRunChangeSet, undoRunChangeSet } from "../run-change-undo"
import { getUsageProviders } from "../usage/registry"
import { runManualRefresh } from "../usage/catch-up"
import { getAppUsageSecret } from "../usage/app-secrets"
import { hasUsageSecret } from "../usage/secrets"
import { getUsageSettings } from "../usage/settings"
import { listCurrentSamples, listProviderStates } from "../usage/store"
import { readDaemonStatus } from "../usage-daemon/lifecycle"
import { searchVoiceHistory } from "../speech/history"
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
