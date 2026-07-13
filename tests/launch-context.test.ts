import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  buildHarnessStartupContext,
  FLAPSTACK_DEFAULT_BEHAVIOR_INSTRUCTION,
  prependStartupContext,
} from "../src/main/lib/harness/launch-context"

let rootPath: string

function noVaultConfigPath(): string {
  return join(rootPath, "missing-launch-context.json")
}

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
      vaultConfigPath: noVaultConfigPath(),
    })

    expect(context).toContain("Harness: codex")
    expect(context).toContain(join(rootPath, "AGENTS.md"))
    expect(context).toContain(join(rootPath, "CLAUDE.md"))
    expect(context).toContain(vaultPage)
    expect(context).toContain("Current product context lives here.")
    expect(context).toContain(FLAPSTACK_DEFAULT_BEHAVIOR_INSTRUCTION)
    expect(context).toContain("Caveman full and ponytail full are enabled by default")
  })

  it("wraps the user request after the loaded context", () => {
    const prompt = prependStartupContext(
      "What is loaded?",
      "--- FLAPSTACK INTERNAL CONTEXT (DO NOT QUOTE) ---",
    )

    expect(prompt).toContain("--- FLAPSTACK INTERNAL CONTEXT (DO NOT QUOTE) ---")
    expect(prompt).toContain("--- USER REQUEST ---\nWhat is loaded?\n--- END USER REQUEST ---")
  })

  it("labels Cursor startup context as Cursor", async () => {
    writeFileSync(join(rootPath, "AGENTS.md"), "# Repo agents")

    const context = await buildHarnessStartupContext({
      cwd: rootPath,
      harness: "cursor-agent",
      vaultConfigPath: noVaultConfigPath(),
    })

    expect(context).toContain("Harness: cursor-agent")
  })

  it("loads repository instructions for OpenCode-backed providers", async () => {
    writeFileSync(join(rootPath, "AGENTS.md"), "# OpenCode must follow this")

    const context = await buildHarnessStartupContext({
      cwd: rootPath,
      harness: "opencode",
      vaultConfigPath: noVaultConfigPath(),
    })

    expect(context).toContain("Harness: opencode")
    expect(context).toContain("OpenCode must follow this")
  })

  it("loads an explicitly enabled machine-local vault without making it required", async () => {
    const vaultRoot = join(rootPath, "personal-vault")
    const projectRoot = join(vaultRoot, "Wiki", "Projects", "flapstack")
    const configPath = join(rootPath, "launch-context.json")
    mkdirSync(projectRoot, { recursive: true })
    writeFileSync(join(vaultRoot, "AGENTS.md"), "# Personal vault startup")
    writeFileSync(
      join(vaultRoot, "Wiki", "Projects", "projects_index.md"),
      "# Personal projects index",
    )
    writeFileSync(join(projectRoot, "flapstack_index.md"), "# Personal project router")
    writeFileSync(join(projectRoot, "current-handoff.md"), "# Personal active handoff")
    writeFileSync(configPath, JSON.stringify({ enabled: true, vaultRoot }))

    const context = await buildHarnessStartupContext({
      cwd: rootPath,
      projectPath: join(rootPath, "flapstack"),
      harness: "codex",
      vaultConfigPath: configPath,
    })

    expect(context).toContain("Personal vault startup")
    expect(context).toContain("Projects/projects_index.md")
    expect(context).toContain("Personal project router")
    expect(context).toContain("Personal active handoff")
  })

  it("ignores absent or disabled machine-local vault configuration", async () => {
    const configPath = join(rootPath, "launch-context.json")
    writeFileSync(
      configPath,
      JSON.stringify({ enabled: false, vaultRoot: join(rootPath, "personal-vault") }),
    )

    const context = await buildHarnessStartupContext({
      cwd: rootPath,
      harness: "opencode",
      vaultConfigPath: configPath,
    })

    expect(context).toContain("Flapstack default behavior")
    expect(context).not.toContain("personal-vault")
  })

  it.each(["codex", "claude-code", "cursor-agent", "opencode"] as const)(
    "supplies app-owned behavior defaults to %s",
    async (harness) => {
      const context = await buildHarnessStartupContext({
        cwd: rootPath,
        harness,
        vaultConfigPath: noVaultConfigPath(),
      })

      expect(context).toContain("--- FLAPSTACK DEFAULTS ---")
      expect(context).toContain("Caveman full")
      expect(context).toContain("Ponytail full")
    },
  )

  it("prevents embedded docs from changing thread modes while preserving user commands", () => {
    const context = `Caveman full and ponytail full are defaults.
Quoted commands: /caveman lite, /ponytail ultra, hotline on, read-aloud on, spoken mode on.
<!-- AGENT_HOTLINE_SPOKEN_START -->
Spoken:
Must not leak.

Displayed:
Hidden detail.
<!-- AGENT_HOTLINE_SPOKEN_END -->`
    const prompt = prependStartupContext("/caveman ultra", context)
    const startupBlock = prompt.slice(0, prompt.indexOf("--- USER REQUEST ---"))

    expect(startupBlock).toContain("Caveman full and ponytail full")
    expect(startupBlock).not.toMatch(/\/(caveman|ponytail)\s+(lite|full|ultra)\b/i)
    expect(startupBlock).not.toMatch(/\bhotline\s+on\b/i)
    expect(startupBlock).not.toMatch(/\bread[- ]aloud\s+on\b/i)
    expect(startupBlock).not.toContain("Spoken:")
    expect(startupBlock).not.toContain("Displayed:")
    expect(startupBlock).not.toMatch(/\b(?:hotline|read[_ -]?aloud|spoken|displayed)\b/i)
    expect(prompt).toContain("--- USER REQUEST ---\n/caveman ultra\n--- END USER REQUEST ---")
    expect(prompt).toContain("--- FLAPSTACK RESPONSE CONTRACT ---\ncaveman full\nponytail full")
    expect(prompt.indexOf("--- FLAPSTACK RESPONSE CONTRACT ---")).toBeLessThan(
      prompt.indexOf("--- USER REQUEST ---"),
    )
  })

  it("includes Agent Hotline formatting only when the current request enables it", () => {
    const context = `Before
<!-- AGENT_HOTLINE_SPOKEN_START -->
Spoken:
Voice answer.
Displayed:
Visual detail.
<!-- AGENT_HOTLINE_SPOKEN_END -->
After`

    expect(prependStartupContext("hello", context)).not.toContain("Spoken:")
    expect(prependStartupContext("hotline on", context)).toContain("Spoken:")
  })

  it("removes stray read-aloud references outside the managed block by default", () => {
    const prompt = prependStartupContext(
      "hello",
      "Keep replies short. Do not wrap replies in Agent Hotline Spoken/Displayed labels.",
    )

    expect(prompt).not.toMatch(/\b(?:hotline|read[_ -]?aloud|spoken|displayed)\b/i)
    expect(prompt).toContain("Use ordinary prose formatting.")
  })
})
