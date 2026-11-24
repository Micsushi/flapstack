import { AGENT_HARNESSES, type AgentHarness } from "../../../shared/harness-types"
import { DEFAULT_OLLAMA_BASE_URL } from "../../../shared/local-model-contract"
import { antigravityEffortVariants } from "../../../shared/antigravity-models"
import { antigravityModels } from "../agent-runtime/antigravity/adapter"
import { claudeCodeRouter } from "../trpc/routers/claude-code"
import { codexRouter } from "../trpc/routers/codex"
import { cursorRouter } from "../trpc/routers/cursor"
import { localModelsRouter } from "../trpc/routers/local-models"
import { opencodeRouter } from "../trpc/routers/opencode"
import { providerCatalogSchema } from "./read-service"
import type { McpCallerIdentity, McpControlResponse } from "./types"
import { z } from "zod"

type Model = { id: string; name: string; reasoningEfforts: readonly string[] }
async function discover(provider: AgentHarness): Promise<Model[]> {
  const ctx = { getWindow: () => null }
  switch (provider) {
    case "codex": {
      const models = await codexRouter.createCaller(ctx).listModels()
      return models.map((model) => ({
        id: model.id,
        name: model.name,
        reasoningEfforts: model.reasoningLevels,
      }))
    }
    case "claude-code": {
      const caller = claudeCodeRouter.createCaller(ctx)
      if (!(await caller.getIntegration()).isConnected) return []
      const models = await caller.listModels()
      return [
        ...new Map(
          models.map((model) => [
            model.id,
            { id: model.id, name: model.label, reasoningEfforts: model.efforts },
          ]),
        ).values(),
      ]
    }
    case "antigravity": {
      const models = await antigravityModels()
      return models.map((model) => ({
        id: model.id,
        name: model.name,
        reasoningEfforts:
          model.nativeEfforts?.map(({ value }) => value) ??
          antigravityEffortVariants(models, model.id).efforts.map((effort) => effort.label),
      }))
    }
    case "cursor-agent": {
      const caller = cursorRouter.createCaller(ctx)
      if (!(await caller.getIntegration()).isConnected) return []
      const catalog = await caller.listModels()
      if (catalog.source !== "cli") return []
      return catalog.models.map((id) => ({ id, name: id, reasoningEfforts: [] }))
    }
    case "local": {
      const catalog = await localModelsRouter
        .createCaller(ctx)
        .catalog({ endpoint: DEFAULT_OLLAMA_BASE_URL })
      return catalog.models
        .filter(
          (model) =>
            model.capabilities.chat.state === "supported" &&
            model.capabilities.streaming.state === "supported",
        )
        .map((model) => ({
          id: model.identity.modelId,
          name: model.identity.modelId,
          reasoningEfforts: [],
        }))
    }
    case "openrouter":
    case "nanogpt": {
      const caller = opencodeRouter.createCaller(ctx)
      if (!(await caller.getKeyStatus({ provider })).configured) return []
      const catalog = await caller.listModels({ provider })
      if (catalog.source === "seed") return []
      return catalog.models.map((model) => ({
        id: `${provider}/${model.id}`,
        name: model.label,
        reasoningEfforts: model.supportsReasoning
          ? ["minimal", "low", "medium", "high", "xhigh"]
          : [],
      }))
    }
  }
}

export async function invokeDesktopModelDiscovery(
  name: string,
  _caller: McpCallerIdentity,
  raw: unknown,
): Promise<McpControlResponse> {
  const input = (
    name === "list_providers" ? z.object({}).strict() : providerCatalogSchema
  ).safeParse(raw)
  if (!input.success)
    return {
      ok: false,
      error: { code: "invalid-input", message: "Invalid provider catalog request." },
    }
  const provider = "provider" in input.data ? (input.data.provider as AgentHarness) : undefined
  const providers = await Promise.all(
    (provider ? [provider] : AGENT_HARNESSES).map(async (id) => {
      try {
        const models = await discover(id)
        return {
          id,
          available: models.length > 0,
          modelCount: models.length,
          ...(name === "list_models" ? { models } : {}),
        }
      } catch {
        return {
          id,
          available: false,
          modelCount: 0,
          reason: "Provider catalog unavailable.",
          ...(name === "list_models" ? { models: [] } : {}),
        }
      }
    }),
  )
  return { ok: true, data: { providers } }
}
