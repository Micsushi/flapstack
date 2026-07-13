/**
 * Generated OpenCode config for OpenRouter + NanoGPT (Track E - E3).
 *
 * Flapstack writes an ISOLATED per-run OpenCode config directory instead of
 * mutating the user's global `~/.config/opencode`. Provider keys come from the
 * encrypted credential store and are injected via env / config at launch - never
 * committed to repo files or logs.
 *
 * Scaffolding stage: `buildOpencodeConfig` produces the config object and
 * `writeIsolatedConfig` writes it to a temp dir. The exact OpenCode config
 * schema (provider block shape, npm SDK id) is pinned in one place here so E2's
 * launcher has a single source of truth to consume.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
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

const TOOL_ENV_GUARD_FILE = "flapstack-tool-env-guard.mjs"

function toolEnvironmentGuard(secretNames: string[]): string {
  return `const SECRET_NAMES = ${JSON.stringify(secretNames)}

export default async function flapstackToolEnvironmentGuard() {
  for (const name of SECRET_NAMES) delete process.env[name]
  return {
    "shell.env": async (_input, output) => {
      for (const name of SECRET_NAMES) output.env[name] = ""
    },
  }
}
`
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
  baseUrlOverride?: string,
  reasoningEnabled = true,
  reasoningEffort: "minimal" | "low" | "medium" | "high" | "xhigh" = "high",
): GeneratedOpencodeConfig {
  const def = getProviderDefinition(provider)
  const key = getProviderKey(provider)
  if (!key) {
    throw new Error(`No API key configured for ${def.label}`)
  }
  const baseUrl =
    baseUrlOverride || (def.allowsCustomBaseUrl && getProviderBaseUrl(provider)) || def.baseUrl
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
                [selectedModelId]: {
                  name: selectedModelId,
                  options: {
                    reasoning: {
                      enabled: reasoningEnabled,
                      effort: reasoningEffort,
                      exclude: !reasoningEnabled,
                    },
                    reasoningEffort: reasoningEnabled ? reasoningEffort : "minimal",
                    includeReasoning: reasoningEnabled,
                  },
                },
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
  baseUrlOverride?: string,
  reasoningEnabled = true,
  reasoningEffort: "minimal" | "low" | "medium" | "high" | "xhigh" = "high",
): {
  configDir: string
  env: Record<string, string>
} {
  const { config, env } = buildOpencodeConfig(
    provider,
    selectedModelId,
    baseUrlOverride,
    reasoningEnabled,
    reasoningEffort,
  )
  const configDir = mkdtempSync(join(tmpdir(), "flapstack-opencode-"))
  const toolGuardPath = join(configDir, TOOL_ENV_GUARD_FILE)
  const secretNames = [
    ...Object.keys(env).filter((name) =>
      /(?:API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(name),
    ),
    "OPENCODE_SERVER_PASSWORD",
  ]
  config.plugin = [pathToFileURL(toolGuardPath).href]
  writeFileSync(toolGuardPath, toolEnvironmentGuard(secretNames), { mode: 0o600 })
  writeFileSync(join(configDir, "opencode.json"), JSON.stringify(config, null, 2), { mode: 0o600 })
  const xdgConfigHome = join(configDir, "xdg-config")
  const xdgDataHome = join(configDir, "xdg-data")
  const xdgStateHome = join(configDir, "xdg-state")
  const xdgCacheHome = join(configDir, "xdg-cache")
  for (const directory of [xdgConfigHome, xdgDataHome, xdgStateHome, xdgCacheHome]) {
    mkdirSync(directory, { recursive: true, mode: 0o700 })
  }
  return {
    configDir,
    // OpenCode reads config from XDG_CONFIG_HOME/opencode or OPENCODE_CONFIG.
    env: {
      ...env,
      OPENCODE_CONFIG: join(configDir, "opencode.json"),
      OPENCODE_DISABLE_DEFAULT_PLUGINS: "1",
      XDG_CONFIG_HOME: xdgConfigHome,
      XDG_DATA_HOME: xdgDataHome,
      XDG_STATE_HOME: xdgStateHome,
      XDG_CACHE_HOME: xdgCacheHome,
    },
  }
}
