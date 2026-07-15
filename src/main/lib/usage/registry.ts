// Stage 2 Track B - U1: usage provider registry.
//
// Single source of truth for the provider adapters the engine (app + daemon)
// iterates. Adding a provider = register it here.

import { createAnthropicProvider } from "./providers/anthropic"
import { createCodexProvider } from "./providers/codex"
import { createCursorProvider } from "./providers/cursor"
import { createNanoGptProvider } from "./providers/nanogpt"
import { createOpenRouterProvider } from "./providers/openrouter"
import { createLocalUsageProvider } from "./providers/local"
import { USAGE_PROVIDER_IDS, type UsageProvider, type UsageProviderId } from "./types"

let registry: Map<UsageProviderId, UsageProvider> | null = null

function build(): Map<UsageProviderId, UsageProvider> {
  const providers: UsageProvider[] = [
    createCodexProvider(),
    createAnthropicProvider(),
    createCursorProvider(),
    createOpenRouterProvider(),
    createNanoGptProvider(),
    createLocalUsageProvider(),
  ]
  const map = new Map<UsageProviderId, UsageProvider>()
  for (const provider of providers) map.set(provider.id, provider)
  // Guard: every declared provider id must have an adapter.
  for (const id of USAGE_PROVIDER_IDS) {
    if (!map.has(id)) throw new Error(`Usage registry missing provider adapter: ${id}`)
  }
  return map
}

export function getUsageProviders(): UsageProvider[] {
  registry ??= build()
  return [...registry.values()]
}

export function getUsageProvider(id: UsageProviderId): UsageProvider | undefined {
  registry ??= build()
  return registry.get(id)
}
