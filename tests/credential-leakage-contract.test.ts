import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8")
}

describe("credential leakage contracts", () => {
  it("exposes status/set/migrate/remove but no renderer plaintext read procedure", () => {
    const router = source("../src/main/lib/trpc/routers/credentials.ts")
    expect(router).toContain("listStatuses")
    expect(router).toContain("migrateLegacy")
    expect(router).toContain("legacyCredentialIds[input.legacyKey] !== input.id")
    expect(router).toContain("remove:")
    expect(router).not.toMatch(/getSecret|readSecret|resolve:\s*publicProcedure/)
  })

  it("does not send Codex or Claude credentials through renderer chat transports", () => {
    const codex = source("../src/renderer/features/agents/lib/acp-chat-transport.ts")
    const claude = source("../src/renderer/features/agents/lib/ipc-chat-transport.ts")
    expect(codex).not.toContain("codexApiKeyAtom")
    expect(codex).not.toContain("authConfig")
    expect(claude).not.toContain("customClaudeConfigAtom")
    expect(claude).not.toContain("customConfig")
  })

  it("keeps legacy storage keys only in the one-time migration inventory", () => {
    const atoms = source("../src/renderer/lib/atoms/index.ts")
    expect(atoms).not.toContain('atomWithStorage<string>("onboarding:codex-api-key"')
    expect(atoms).not.toContain('atomWithStorage<string>("agents:openai-api-key"')
    expect(atoms).not.toContain(
      'atomWithStorage<CustomClaudeConfig>(\n  "agents:claude-custom-config"',
    )
  })

  it("keeps Voice secret editing in the provider credential manager", () => {
    const voice = source("../src/renderer/components/dialogs/settings-tabs/agents-voice-tab.tsx")
    const manager = source(
      "../src/renderer/components/dialogs/settings-tabs/credential-management.tsx",
    )
    expect(voice).not.toContain('placeholder="sk-..."')
    expect(voice).toContain('setActiveSettingsTab("api-providers")')
    expect(manager).toContain('autoComplete="new-password"')
    expect(manager).toContain("stored values are never shown")
    expect(manager).toContain("window.confirm")
  })

  it("removes only the app-managed Codex API key without logging out ChatGPT", () => {
    const codex = source("../src/main/lib/trpc/routers/codex.ts")
    const procedure = codex.slice(codex.indexOf("removeApiKey:"), codex.indexOf("logout:"))
    expect(procedure).toContain('service.remove("codex.api-key")')
    expect(procedure).toContain("cleanupAllCodexProviders()")
    expect(procedure).not.toContain("runCodexCli")
  })

  it("matches the Preview bundle executable in stale-process cleanup", () => {
    const dev = source("../scripts/dev.mjs")
    const verifier = source("../scripts/verify-dev-instance.mjs")
    expect(dev).toContain("Flapstack Preview.app/Contents/MacOS/Flapstack Preview")
    expect(verifier).toContain("realpathSync")
    expect(verifier).toContain("--app-path=${root}")
    expect(verifier).toContain("release-preview")
  })
})
