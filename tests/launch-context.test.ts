import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  buildHarnessStartupContext,
  prependStartupContext,
} from "../src/main/lib/harness/launch-context"

let rootPath: string

beforeEach(() => {
  rootPath = join(tmpdir(), `flapstack-launch-context-${crypto.randomUUID()}`)
  mkdirSync(rootPath, { recursive: true })
})

afterEach(() => {
  rmSync(rootPath, { recursive: true, force: true })
})

describe("harness launch context", () => {
  it("loads repo startup files and absolute vault-style references", async () => {
    const vaultDir = join(rootPath, "vault")
    const vaultPage = join(vaultDir, "current-handoff.md")
    mkdirSync(vaultDir, { recursive: true })

    writeFileSync(join(rootPath, "AGENTS.md"), "# Repo agents\nRead CLAUDE.md too.")
    writeFileSync(
      join(rootPath, "CLAUDE.md"),
      `# Claude\nRead this vault page before work:\n${vaultPage}`,
    )
    writeFileSync(vaultPage, "# Handoff\nCurrent product context lives here.")

    const context = await buildHarnessStartupContext({
      cwd: rootPath,
      harness: "codex",
    })

    expect(context).toContain("Harness: codex")
    expect(context).toContain(join(rootPath, "AGENTS.md"))
    expect(context).toContain(join(rootPath, "CLAUDE.md"))
    expect(context).toContain(vaultPage)
    expect(context).toContain("Current product context lives here.")
  })

  it("wraps the user request after the loaded context", () => {
    const prompt = prependStartupContext("What is loaded?", "[FLAPSTACK STARTUP CONTEXT]")

    expect(prompt).toContain("[FLAPSTACK STARTUP CONTEXT]")
    expect(prompt).toContain("[USER REQUEST]\nWhat is loaded?\n[/USER REQUEST]")
  })

  it("labels Cursor startup context as Cursor", async () => {
    writeFileSync(join(rootPath, "AGENTS.md"), "# Repo agents")

    const context = await buildHarnessStartupContext({
      cwd: rootPath,
      harness: "cursor-agent",
    })

    expect(context).toContain("Harness: cursor-agent")
  })
})
