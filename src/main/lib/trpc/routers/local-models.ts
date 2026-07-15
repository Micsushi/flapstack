import { observable } from "@trpc/server/observable"
import { and, eq } from "drizzle-orm"
import { app } from "electron"
import {
  createLocalModelRunMetadata,
  resolveLocalModelSelection,
  type LocalModelCatalogSnapshot,
} from "../../../../shared/local-model-contract"
import { parseCustomPermissionCapabilities } from "../../../../shared/permission-capabilities"
import {
  fallbackToCachedLocalModelCatalog,
  getOllamaEndpointConfig,
  probeLocalModelCatalog,
  readLocalModelCatalogCache,
} from "../../harness/local-model-catalog"
import {
  createLocalModelDevFixtureCatalog,
  createLocalModelDevFixtureFetch,
  isLocalModelDevFixtureEnabled,
} from "../../harness/local-model-dev-fixture"
import {
  createDatabaseLocalModelRunPersistence,
  LocalModelChatService,
} from "../../harness/local-model-stream"
import { chats, getDatabase, subChats } from "../../db"
import type { UIMessageChunk } from "../../claude/types"
import { assertRegisteredWorktree } from "../../git/security/path-validation"
import { parsePermissionMode } from "../../permissions"
import { captureLocalModelRunUsage } from "../../usage/run-usage"
import { z } from "zod"
import { publicProcedure, router } from "../index"

const catalogCache = new Map<string, LocalModelCatalogSnapshot>()
let chatService: LocalModelChatService | null = null

function devFixtureEnabled(): boolean {
  return isLocalModelDevFixtureEnabled({
    isPackaged: app?.isPackaged ?? process.env.NODE_ENV === "production",
    rendererUrl: process.env.ELECTRON_RENDERER_URL,
  })
}

function getLocalModelChatService() {
  chatService ??= new LocalModelChatService({
    persistence: createDatabaseLocalModelRunPersistence(getDatabase()),
    captureUsage: async (usage) => {
      await captureLocalModelRunUsage(getDatabase(), usage)
    },
  })
  return chatService
}

function parseStoredCustomPermissions(value: string | null) {
  if (!value) return null
  try {
    return parseCustomPermissionCapabilities(JSON.parse(value))
  } catch {
    return null
  }
}

export async function refreshLocalModelCatalog(input: {
  endpoint: string
  fetchImpl?: typeof fetch
  now?: () => number
}): Promise<LocalModelCatalogSnapshot> {
  const config = getOllamaEndpointConfig({ baseUrl: input.endpoint })
  const fixture = devFixtureEnabled() ? createLocalModelDevFixtureCatalog(config.baseUrl) : null
  if (fixture) {
    if (fixture.state === "ready" || fixture.state === "empty") {
      catalogCache.set(config.baseUrl, fixture)
    }
    return fixture
  }
  const nowMs = (input.now ?? Date.now)()
  const cached = readLocalModelCatalogCache(catalogCache.get(config.baseUrl), nowMs)
  const live = await probeLocalModelCatalog({
    config,
    fetchImpl: input.fetchImpl,
    now: () => nowMs,
  })
  const resolved = fallbackToCachedLocalModelCatalog(live, cached)

  if (live.state === "ready" || live.state === "empty") {
    catalogCache.set(config.baseUrl, live)
  }

  return resolved
}

export const localModelsRouter = router({
  diagnostics: publicProcedure
    .input(z.object({ endpoint: z.string().trim().min(1).max(512) }))
    .query(({ input }) => {
      const endpoint = getOllamaEndpointConfig({ baseUrl: input.endpoint })
      const cached = catalogCache.get(endpoint.baseUrl)
      return {
        provider: "ollama" as const,
        endpoint: endpoint.baseUrl,
        endpointPolicy: "loopback-only" as const,
        catalogState: cached?.state ?? ("not-checked" as const),
        catalogModelCount: cached?.models.length ?? 0,
        ...getLocalModelChatService().diagnostics(),
      }
    }),
  catalog: publicProcedure
    .input(z.object({ endpoint: z.string().trim().min(1).max(512) }))
    .query(({ input }) => refreshLocalModelCatalog(input)),
  chat: publicProcedure
    .input(
      z.object({
        chatId: z.string().min(1),
        subChatId: z.string().min(1),
        runId: z.string().min(1),
        prompt: z.string().min(1),
        model: z.string().min(1),
        endpoint: z.string().trim().min(1).max(512),
        cwd: z.string().min(1),
        projectPath: z.string().optional(),
      }),
    )
    .subscription(({ input }) =>
      observable<UIMessageChunk>((emit) => {
        let active = true
        const safeNext = (chunk: UIMessageChunk) => {
          if (active) emit.next(chunk)
        }
        const safeComplete = () => {
          if (!active) return
          active = false
          emit.complete()
        }

        void (async () => {
          try {
            const db = getDatabase()
            const row = db
              .select({
                chatPermissionMode: chats.permissionMode,
                subChatPermissionMode: subChats.permissionMode,
                customPermissions: chats.customPermissions,
                chatHarness: chats.harness,
                chatModel: chats.model,
                subChatHarness: subChats.harness,
                subChatModel: subChats.model,
                chatWorktreePath: chats.worktreePath,
                worktreePath: subChats.worktreePath,
              })
              .from(subChats)
              .innerJoin(chats, eq(chats.id, subChats.chatId))
              .where(and(eq(subChats.id, input.subChatId), eq(chats.id, input.chatId)))
              .get()
            if (!row) throw new Error("Local model chat was not found.")

            const permissionMode = parsePermissionMode(
              row.subChatPermissionMode ?? row.chatPermissionMode,
            )
            if (!permissionMode) throw new Error("Local model permission mode is invalid.")
            const worktree = assertRegisteredWorktree(
              row.worktreePath ?? row.chatWorktreePath ?? input.cwd,
            )
            const project = input.projectPath
              ? assertRegisteredWorktree(input.projectPath)
              : undefined
            const storedLocalModel =
              row.subChatHarness === "local" && row.subChatModel
                ? row.subChatModel
                : row.chatHarness === "local"
                  ? row.chatModel
                  : null
            if (storedLocalModel && storedLocalModel !== input.model) {
              safeNext({
                type: "error",
                errorText:
                  "The stored local model does not match this launch. Re-select the model and retry.",
              })
              safeNext({ type: "finish" })
              safeComplete()
              return
            }
            const launchModel = storedLocalModel ?? input.model

            const catalog = await refreshLocalModelCatalog({ endpoint: input.endpoint })
            const selection = resolveLocalModelSelection(catalog, launchModel)
            if (!selection.runnable || !selection.model) {
              safeNext({
                type: "error",
                errorText:
                  selection.limitations[0]?.message ??
                  "The selected local model is unavailable or cannot chat.",
              })
              safeNext({ type: "finish" })
              safeComplete()
              return
            }

            const customPermissions = parseStoredCustomPermissions(row.customPermissions)
            const metadata = createLocalModelRunMetadata({
              catalog,
              model: selection.model,
              permissionMode,
              customPermissions,
            })
            const endpoint = getOllamaEndpointConfig({ baseUrl: input.endpoint })
            const fixtureFetch = devFixtureEnabled()
              ? createLocalModelDevFixtureFetch(endpoint.baseUrl)
              : null
            for await (const chunk of getLocalModelChatService().stream({
              runId: input.runId,
              chatId: input.chatId,
              subChatId: input.subChatId,
              prompt: input.prompt,
              model: launchModel,
              permissionMode,
              customPermissions: row.customPermissions,
              cwd: worktree.canonicalPath,
              projectPath: project?.canonicalPath,
              worktreePath: worktree.canonicalPath,
              metadata,
              endpoint,
              ...(fixtureFetch ? { fetchImpl: fixtureFetch } : {}),
            })) {
              safeNext(chunk)
            }
            safeComplete()
          } catch (error) {
            safeNext({
              type: "error",
              errorText:
                error instanceof Error && error.message.startsWith("Local model")
                  ? error.message
                  : "The local model run failed safely.",
            })
            safeNext({ type: "finish" })
            safeComplete()
          }
        })()

        return () => {
          active = false
          getLocalModelChatService().cancel(input.runId)
        }
      }),
    ),
  cancel: publicProcedure
    .input(z.object({ runId: z.string().min(1) }))
    .mutation(({ input }) => ({ cancelled: getLocalModelChatService().cancel(input.runId) })),
})
