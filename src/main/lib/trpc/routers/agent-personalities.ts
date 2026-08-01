import { app, BrowserWindow } from "electron"
import { createHash } from "node:crypto"
import { join } from "node:path"
import { z } from "zod"
import {
  agentPersonalityTraitsSchema,
  agentPersonalityVersionRefSchema,
} from "../../../../shared/agent-personalities"
import { getDatabase } from "../../db"
import {
  parseAgentPersonalityMarkdown,
  serializeAgentPersonalityMarkdown,
} from "../../agent-profiles/personality-markdown"
import { AgentPersonalityStore } from "../../agent-profiles/personality-store"
import { AgentPersonalityRootWatcher } from "../../agent-profiles/personality-watcher"
import { createAgentProfileService } from "../../agent-profiles/service"
import { getOrCreateProjectVaultPolicy } from "../../project-vaults/policy"
import { ensureProjectVaultGitExclusion } from "../../project-vaults/git-exclusion"
import { assertProjectVaultContentSafe } from "../../project-vaults/content-safety"
import { publicProcedure, router } from "../index"

const projectIdSchema = z.string().trim().min(1).max(200)
const scopeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("user"), projectId: z.null() }).strict(),
  z.object({ type: z.literal("project"), projectId: projectIdSchema }).strict(),
])
const contentSchema = z.object({
  name: z.string().trim().min(1).max(160),
  scope: scopeSchema,
  base: agentPersonalityVersionRefSchema.nullable(),
  traits: agentPersonalityTraitsSchema,
  body: z.string().max(65_536),
})

export const AGENT_PERSONALITIES_CHANGED_EVENT = "agent-personalities:changed"
const personalityRootWatcher = new AgentPersonalityRootWatcher(() => changed(undefined))

export const agentPersonalitiesRouter = router({
  list: publicProcedure
    .input(z.object({ projectId: projectIdSchema.optional() }).strict().optional())
    .query(({ input }) => {
      const store = createAgentPersonalityStore()
      return [
        ...store.list({ type: "user", projectId: null }),
        ...(input?.projectId ? store.list({ type: "project", projectId: input.projectId }) : []),
      ]
    }),

  get: publicProcedure
    .input(
      z
        .object({
          ref: agentPersonalityVersionRefSchema,
          scope: scopeSchema,
          allowArchivedHistory: z.boolean().default(false),
        })
        .strict(),
    )
    .query(({ input }) => {
      const store = createAgentPersonalityStore()
      return input.allowArchivedHistory
        ? store.get(input.ref, input.scope)
        : store.resolve(input.ref, input.scope)
    }),

  create: publicProcedure
    .input(contentSchema.strict())
    .mutation(({ input }) => changed(createAgentPersonalityStore().create(input))),

  update: publicProcedure
    .input(
      contentSchema
        .omit({ scope: true })
        .extend({
          personalityId: z.string().uuid(),
          expectedVersion: z.number().int().min(1),
          scope: scopeSchema,
        })
        .strict(),
    )
    .mutation(({ input }) => changed(createAgentPersonalityStore().update(input))),

  archive: publicProcedure
    .input(
      z
        .object({
          personalityId: z.string().uuid(),
          expectedVersion: z.number().int().min(1),
          scope: scopeSchema,
        })
        .strict(),
    )
    .mutation(({ input }) => changed(createAgentPersonalityStore().archive(input))),

  restore: publicProcedure
    .input(
      z
        .object({
          personalityId: z.string().uuid(),
          expectedVersion: z.number().int().min(1),
          scope: scopeSchema,
        })
        .strict(),
    )
    .mutation(({ input }) => changed(createAgentPersonalityStore().restore(input))),

  previewInlineConversion: publicProcedure
    .input(
      z
        .object({
          profile: z
            .object({
              profileId: z.string().trim().min(1).max(200),
              version: z.number().int().min(1),
            })
            .strict(),
        })
        .strict(),
    )
    .query(({ input }) =>
      createAgentProfileService(getDatabase()).previewInlinePersonalityConversion(input.profile),
    ),

  confirmInlineConversion: publicProcedure
    .input(
      z
        .object({
          profile: z
            .object({
              profileId: z.string().trim().min(1).max(200),
              version: z.number().int().min(1),
            })
            .strict(),
          expectedDigest: z.string().regex(/^[0-9a-f]{64}$/),
        })
        .strict(),
    )
    .mutation(({ input }) => {
      const profiles = createAgentProfileService(getDatabase())
      const personalityId = inlinePersonalityId(input.profile.profileId, input.profile.version)
      const personalityRef = { personalityId, version: 1 }
      const state = profiles.inlinePersonalityConversionState(input.profile, personalityRef)
      if (state.kind === "existing") {
        const personality = createAgentPersonalityStore().get(
          personalityRef,
          state.value.profile.scope.type === "project"
            ? state.value.profile.scope
            : { type: "user", projectId: null },
        )
        return changed({ profile: state.value, personality })
      }
      const preview = state.value
      if (preview.digest !== input.expectedDigest) {
        throw new Error("Inline Personality conversion changed after preview.")
      }
      const personality = createAgentPersonalityStore().createWithId(personalityId, {
        name: preview.name,
        scope: preview.scope.type === "project" ? preview.scope : { type: "user", projectId: null },
        base: null,
        traits: preview.traits,
        body: preview.body,
      })
      const result = profiles.convertInlinePersonality({
        profile: input.profile,
        expectedDigest: input.expectedDigest,
        personality: personalityRef,
      })
      return changed({ profile: result, personality })
    }),

  exportMarkdown: publicProcedure
    .input(
      z
        .object({
          ref: agentPersonalityVersionRefSchema,
          scope: scopeSchema,
        })
        .strict(),
    )
    .query(({ input }) => {
      const document = createAgentPersonalityStore().get(input.ref, input.scope)
      return {
        source: serializeAgentPersonalityMarkdown(document),
        digest: document.digest,
      }
    }),

  previewImport: publicProcedure
    .input(
      z
        .object({
          source: z.string().min(1).max(65_536),
          sourceLabel: z.string().trim().min(1).max(500),
          scope: scopeSchema.optional(),
        })
        .strict(),
    )
    .mutation(({ input }) => {
      assertProjectVaultContentSafe(input.source)
      const document = parseAgentPersonalityMarkdown(input.source)
      const baseStatus = importBaseStatus(
        createAgentPersonalityStore(),
        document.metadata.base,
        input.scope,
      )
      return {
        metadata: document.metadata,
        body: document.body,
        digest: document.digest,
        untrusted: true as const,
        unresolvedBase: document.metadata.base,
        baseStatus,
        sourceLabel: input.sourceLabel,
      }
    }),

  confirmImport: publicProcedure
    .input(
      z
        .object({
          source: z.string().min(1).max(65_536),
          sourceLabel: z.string().trim().min(1).max(500),
          expectedDigest: z.string().regex(/^[0-9a-f]{64}$/),
          scope: scopeSchema,
          baseResolution: z.enum(["preserve-validated", "remove"]).optional(),
        })
        .strict(),
    )
    .mutation(({ input }) => {
      assertProjectVaultContentSafe(input.source)
      const document = parseAgentPersonalityMarkdown(input.source)
      if (document.digest !== input.expectedDigest) {
        throw new Error("Personality import changed after preview.")
      }
      if (document.metadata.base && !input.baseResolution) {
        throw new Error(
          "Imported Personality base requires explicit preserve or remove confirmation.",
        )
      }
      if (document.metadata.base && input.baseResolution === "preserve-validated") {
        createAgentPersonalityStore().resolveCombinedVisible(document.metadata.base, input.scope)
      }
      return changed(
        createAgentPersonalityStore().create(
          {
            name: document.metadata.name,
            scope: input.scope,
            base: input.baseResolution === "preserve-validated" ? document.metadata.base : null,
            traits: document.metadata.traits,
            body: document.body,
          },
          {
            kind: "import",
            sourceLabel: input.sourceLabel,
            trusted: false,
          },
        ),
      )
    }),
})

export function createAgentPersonalityStore(): AgentPersonalityStore {
  return new AgentPersonalityStore({
    userRoot: join(app.getPath("userData"), "data", "agent-personalities"),
    projectRoot: (projectId) => {
      const policy = getOrCreateProjectVaultPolicy(getDatabase(), {
        projectId,
        appDataRoot: app.getPath("userData"),
      })
      if (policy.locationMode === "project-owned" && !policy.gitTrackingEnabled) {
        ensureProjectVaultGitExclusion(join(policy.vaultPath, "..", ".."))
      }
      return join(policy.vaultPath, "personalities")
    },
    observeRoot: (root) => {
      void personalityRootWatcher.observe(root)
    },
  })
}

export async function closeAgentPersonalityWatchers(): Promise<void> {
  await personalityRootWatcher.close()
}

function changed<T>(result: T): T {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed() || window.webContents.isDestroyed()) continue
    try {
      window.webContents.send(AGENT_PERSONALITIES_CHANGED_EVENT)
    } catch {
      // One failed renderer must not turn a committed local change into an apparent failure.
    }
  }
  return result
}

function importBaseStatus(
  store: AgentPersonalityStore,
  base: z.infer<typeof agentPersonalityVersionRefSchema> | null,
  scope: z.infer<typeof scopeSchema> | undefined,
): "none" | "validated" | "unresolved" {
  if (!base) return "none"
  if (!scope) return "unresolved"
  try {
    store.resolveCombinedVisible(base, scope)
    return "validated"
  } catch {
    return "unresolved"
  }
}

function inlinePersonalityId(profileId: string, version: number): string {
  const bytes = createHash("sha256")
    .update(`flapstack-inline-personality\0${profileId}\0${version}`)
    .digest()
    .subarray(0, 16)
  bytes[6] = (bytes[6]! & 0x0f) | 0x50
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = bytes.toString("hex")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
