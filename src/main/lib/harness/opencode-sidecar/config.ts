/**
 * Generated OpenCode config for OpenRouter + NanoGPT (Track E — E3).
 *
 * Flapstack writes an ISOLATED per-run OpenCode config directory instead of
 * mutating the user's global `~/.config/opencode`. Provider keys come from the
 * encrypted credential store and are injected via env / config at launch — never
 * committed to repo files or logs.
 *
 * Scaffolding stage: `buildOpencodeConfig` produces the config object and
 * `writeIsolatedConfig` writes it to a temp dir. The exact OpenCode config
 * schema (provider block shape, npm SDK id) is pinned in one place here so E2's
 * launcher has a single source of truth to consume.
 */

import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { getProviderBaseUrl, getProviderKey } from "./credentials"
import { getProviderDefinition } from "./catalog"
import type { OpencodeProviderId } from "./contract"

/** App attribution headers so provider dashboards can identify Flapstack runs. */
export const FLAPSTACK_ATTRIBUTION_HEADERS: Record<string, string> = {
  "HTTP-Referer": "https://flapstack.local",
  "X-Title": "Flapstack",
}

export type GeneratedOpencodeConfig = {
  /** JSON written to `<configDir>/opencode.json`. */
  config: Record<string, unknown>
  /** Env vars set on the sidecar process (keys live here, not in the file). */
  env: Record<string, string>
}

/**
 * Build the OpenCode config + env for one provider. The provider block follows
 * OpenCode's OpenAI-compatible provider shape (`npm: @ai-sdk/openai-compatible`)
 * with the base URL and attribution headers; the API key is supplied via env so
 * it never lands in the on-disk config file. Permissions are sent with each
 * session request because that is the OpenCode HTTP API's enforcement boundary.
 */
export function buildOpencodeConfig(
  provider: OpencodeProviderId,
  selectedModelId?: string,
): GeneratedOpencodeConfig {
  const def = getProviderDefinition(provider)
  const key = getProviderKey(provider)
  if (!key) {
    throw new Error(`No API key configured for ${def.label}`)
  }
  const baseUrl = (def.allowsCustomBaseUrl && getProviderBaseUrl(provider)) || def.baseUrl
  const envKey = `FLAPSTACK_${provider.toUpperCase()}_API_KEY`

  const config: Record<string, unknown> = {
    $schema: "https://opencode.ai/config.json",
    provider: {
      [def.opencodeProviderId]: {
        npm: "@ai-sdk/openai-compatible",
        name: def.label,
        options: {
          baseURL: baseUrl,
          apiKey: `{env:${envKey}}`,
          headers: FLAPSTACK_ATTRIBUTION_HEADERS,
        },
        // OpenCode only exposes custom-provider models declared in this map.
        // Declare the exact selected model for this isolated run instead of
        // copying an unbounded remote catalog into a config file.
        ...(selectedModelId
          ? {
              models: {
                [selectedModelId]: { name: selectedModelId },
              },
            }
          : {}),
      },
    },
  }

  return {
    config,
    env: { [envKey]: key },
  }
}

/**
 * Write the generated config to a fresh isolated dir and return its path plus
 * the env to pass to the child process. Caller is responsible for cleanup.
 */
export function writeIsolatedConfig(
  provider: OpencodeProviderId,
  selectedModelId?: string,
): {
  configDir: string
  env: Record<string, string>
} {
  const { config, env } = buildOpencodeConfig(provider, selectedModelId)
  const configDir = mkdtempSync(join(tmpdir(), "flapstack-opencode-"))
  writeFileSync(join(configDir, "opencode.json"), JSON.stringify(config, null, 2), { mode: 0o600 })
  return {
    configDir,
    // OpenCode reads config from XDG_CONFIG_HOME/opencode or OPENCODE_CONFIG.
    env: { ...env, OPENCODE_CONFIG: join(configDir, "opencode.json") },
  }
}
