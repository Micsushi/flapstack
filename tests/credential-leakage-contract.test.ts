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
})
