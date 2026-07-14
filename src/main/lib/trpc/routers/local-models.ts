import type { LocalModelCatalogSnapshot } from "../../../../shared/local-model-contract"
import {
  fallbackToCachedLocalModelCatalog,
  getOllamaEndpointConfig,
  probeLocalModelCatalog,
  readLocalModelCatalogCache,
} from "../../harness/local-model-catalog"
import { z } from "zod"
import { publicProcedure, router } from "../index"

const catalogCache = new Map<string, LocalModelCatalogSnapshot>()

export async function refreshLocalModelCatalog(input: {
  endpoint: string
  fetchImpl?: typeof fetch
  now?: () => number
}): Promise<LocalModelCatalogSnapshot> {
  const config = getOllamaEndpointConfig({ baseUrl: input.endpoint })
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
  catalog: publicProcedure
    .input(z.object({ endpoint: z.string().trim().min(1).max(512) }))
    .query(({ input }) => refreshLocalModelCatalog(input)),
})
