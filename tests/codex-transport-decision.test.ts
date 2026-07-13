import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { CODEX_TRANSPORT_DECISION } from "../src/main/lib/harness/codex-transport-decision"

describe("Codex transport decision", () => {
  it("keeps the pinned ACP adapter that already fronts Codex App Server", () => {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
      dependencies?: Record<string, string>
    }

    expect(CODEX_TRANSPORT_DECISION).toMatchObject({
      selectedAdapter: "codex-acp/app-server",
      backendCommand: "codex app-server",
      decision: "retain-acp",
    })
    expect(packageJson.dependencies?.[CODEX_TRANSPORT_DECISION.adapterPackage]).toBe(
      CODEX_TRANSPORT_DECISION.pinnedAdapterVersion,
    )
    expect(Object.values(CODEX_TRANSPORT_DECISION.capabilities).every(Boolean)).toBe(true)
    expect(CODEX_TRANSPORT_DECISION.rollback).toContain("ACP")
  })
})
