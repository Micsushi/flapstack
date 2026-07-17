import { execFileSync } from "node:child_process"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  buildHarnessContextBundle,
  buildHarnessStartupContext,
  getLastHarnessContextFingerprint,
  FLAPSTACK_DEFAULT_BEHAVIOR_INSTRUCTION,
  buildStartupInstructions,
  prependStartupContext,
} from "../src/main/lib/harness/launch-context"
import {
  collectGitPreflightSnapshot,
  isRepositoryStateQuestion,
} from "../src/main/lib/harness/git-preflight"

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
    expect(context).not.toContain("Loaded context")
  })

  it("wraps the user request after the loaded context", () => {
    const prompt = prependStartupContext(
      "What is loaded?",
      "--- FLAPSTACK INTERNAL CONTEXT (DO NOT QUOTE) ---",
    )

    expect(prompt).toContain("--- FLAPSTACK INTERNAL CONTEXT (DO NOT QUOTE) ---")
    expect(prompt).toContain("--- USER REQUEST ---\nWhat is loaded?\n--- END USER REQUEST ---")
  })

  it("builds provider-native instructions without embedding the user request", () => {
    const instructions = buildStartupInstructions("Follow repo rules.", "Fix the test")

    expect(instructions).toContain("Follow repo rules.")
    expect(instructions).not.toContain("FLAPSTACK RESPONSE CONTRACT")
    expect(instructions).not.toContain("--- USER REQUEST ---")
    expect(instructions).not.toContain("Fix the test")
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

  it("does not duplicate CLAUDE.md when Claude loads provider-native instructions", async () => {
    writeFileSync(join(rootPath, "AGENTS.md"), "# Shared agent rules")
    writeFileSync(join(rootPath, "CLAUDE.md"), "# Native Claude rules")

    const bundle = await buildHarnessContextBundle({
      cwd: rootPath,
      harness: "claude-code",
      providerNativeInstructions: true,
      vaultConfigPath: noVaultConfigPath(),
    })

    expect(bundle.context).toContain("Shared agent rules")
    expect(bundle.context).not.toContain("Native Claude rules")
    expect(bundle.metadata.sourcePaths[0]).toBe(join(rootPath, "AGENTS.md"))
    expect(bundle.metadata.sourcePaths.some((sourcePath) => sourcePath.endsWith("CLAUDE.md"))).toBe(
      false,
    )
  })

  it("does not duplicate AGENTS.md when Codex loads provider-native instructions", async () => {
    writeFileSync(join(rootPath, "AGENTS.md"), "# Native Codex rules")
    writeFileSync(join(rootPath, "CLAUDE.md"), "# Shared cross-provider rules")

    const bundle = await buildHarnessContextBundle({
      cwd: rootPath,
      harness: "codex",
      providerNativeInstructions: true,
      vaultConfigPath: noVaultConfigPath(),
    })

    expect(bundle.context).not.toContain("Native Codex rules")
    expect(bundle.context).toContain("Shared cross-provider rules")
    expect(bundle.metadata.sourcePaths).not.toContain(join(rootPath, "AGENTS.md"))
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
    expect(prompt).not.toContain("--- FLAPSTACK RESPONSE CONTRACT ---")
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
    expect(buildStartupInstructions(context, "continue", { hotlineEnabled: true })).toContain(
      "Spoken:",
    )
    expect(
      buildStartupInstructions(context, "hotline off", { hotlineEnabled: false }),
    ).not.toContain("Spoken:")
  })

  it("removes stray read-aloud references outside the managed block by default", () => {
    const prompt = prependStartupContext(
      "hello",
      "Keep replies short. Do not wrap replies in Agent Hotline Spoken/Displayed labels.",
    )

    expect(prompt).not.toMatch(/\b(?:hotline|read[_ -]?aloud|spoken|displayed)\b/i)
    expect(prompt).toBe("hello")
  })

  it("keeps resumed session context compact without resending startup files", async () => {
    writeFileSync(join(rootPath, "AGENTS.md"), `# Repo agents\n${"x".repeat(20_000)}`)

    const fullBundle = await buildHarnessContextBundle({
      cwd: rootPath,
      harness: "codex",
      sessionMode: "new",
      vaultConfigPath: noVaultConfigPath(),
    })
    const fullContext = fullBundle.context
    const resumedContext = await buildHarnessStartupContext({
      cwd: rootPath,
      harness: "codex",
      sessionMode: "resumed",
      vaultConfigPath: noVaultConfigPath(),
      previousSourceFingerprint: fullBundle.metadata.sourceFingerprint,
    })

    expect(fullContext).toContain("# Repo agents")
    expect(fullContext.length).toBeLessThan(8_500)
    expect(resumedContext).toContain("FLAPSTACK COMPACT CONTEXT")
    expect(resumedContext).not.toContain("# Repo agents")
    expect(resumedContext.length).toBeLessThan(800)
    expect(resumedContext.length).toBeLessThan(fullContext.length)
  })

  it("returns deterministic source metadata without persisting source contents", async () => {
    const agentsPath = join(rootPath, "AGENTS.md")
    writeFileSync(agentsPath, "# Repo agents\nFollow the repository rules.")

    const first = await buildHarnessContextBundle({
      cwd: rootPath,
      harness: "codex",
      sessionMode: "new",
      vaultConfigPath: noVaultConfigPath(),
    })
    const second = await buildHarnessContextBundle({
      cwd: rootPath,
      harness: "codex",
      sessionMode: "resumed",
      vaultConfigPath: noVaultConfigPath(),
      previousSourceFingerprint: first.metadata.sourceFingerprint,
    })

    expect(first.metadata.sourcePaths[0]).toBe(agentsPath)
    expect(first.metadata.sourceFingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(first.metadata.sourceFingerprint).toBe(second.metadata.sourceFingerprint)
    expect(first.metadata.sourceChars).toBeGreaterThan(0)
    expect(first.metadata).not.toHaveProperty("sourceContents")
    expect(second.metadata.mode).toBe("resumed")
  })

  it("resends startup files when their fingerprint changed during a provider session", async () => {
    const agentsPath = join(rootPath, "AGENTS.md")
    writeFileSync(agentsPath, "# Repo agents\nOriginal instruction.")
    const first = await buildHarnessContextBundle({
      cwd: rootPath,
      harness: "codex",
      sessionMode: "new",
      vaultConfigPath: noVaultConfigPath(),
    })

    writeFileSync(agentsPath, "# Repo agents\nChanged safety instruction.")
    const resumed = await buildHarnessContextBundle({
      cwd: rootPath,
      harness: "codex",
      sessionMode: "resumed",
      previousSourceFingerprint: first.metadata.sourceFingerprint,
      vaultConfigPath: noVaultConfigPath(),
    })

    expect(resumed.metadata.sourceFingerprint).not.toBe(first.metadata.sourceFingerprint)
    expect(resumed.context).toContain("Changed safety instruction.")
    expect(resumed.context).not.toContain("FLAPSTACK COMPACT CONTEXT")
  })

  it("finds the latest persisted startup fingerprint", () => {
    const older = "a".repeat(64)
    const newer = "b".repeat(64)
    expect(
      getLastHarnessContextFingerprint([
        { role: "assistant", metadata: { context: { sourceFingerprint: older } } },
        { role: "user", parts: [] },
        { role: "assistant", metadata: { context: { sourceFingerprint: newer } } },
      ]),
    ).toBe(newer)
    expect(getLastHarnessContextFingerprint([{ metadata: { context: {} } }])).toBeUndefined()
  })

  it.each([
    "What is the repository status?",
    "How much progress is complete?",
    "What remains in Stage 3?",
    "List every worktree and branch",
  ])("detects a repository-state question: %s", (prompt) => {
    expect(isRepositoryStateQuestion(prompt)).toBe(true)
  })

  it("does not run Git preflight for unrelated prompts", async () => {
    const context = await buildHarnessStartupContext({
      cwd: rootPath,
      harness: "claude-code",
      userPrompt: "Explain this TypeScript function",
      vaultConfigPath: noVaultConfigPath(),
    })

    expect(context).not.toContain("LIVE GIT PREFLIGHT")
  })

  it("injects deterministic live Git scope for repository-state questions", async () => {
    const repositoryPath = join(rootPath, "repo")
    const integrationPath = join(rootPath, "repo-integration")
    mkdirSync(repositoryPath, { recursive: true })
    writeFileSync(join(repositoryPath, "README.md"), "initial\n")
    execFileSync("git", ["init", "-b", "main"], { cwd: repositoryPath })
    execFileSync("git", ["add", "README.md"], { cwd: repositoryPath })
    execFileSync(
      "git",
      [
        "-c",
        "user.name=Flapstack Test",
        "-c",
        "user.email=flapstack-test@example.invalid",
        "commit",
        "-m",
        "initial",
      ],
      { cwd: repositoryPath },
    )
    execFileSync("git", ["branch", "integration"], { cwd: repositoryPath })
    execFileSync("git", ["worktree", "add", integrationPath, "integration"], {
      cwd: repositoryPath,
    })
    writeFileSync(join(repositoryPath, "dirty.txt"), "uncommitted\n")

    const snapshot = await collectGitPreflightSnapshot(repositoryPath)
    const bundle = await buildHarnessContextBundle({
      cwd: repositoryPath,
      harness: "codex",
      userPrompt: "What remains in Stage 3?",
      sessionMode: "resumed",
      vaultConfigPath: noVaultConfigPath(),
    })
    const context = bundle.context

    expect(snapshot).not.toBeNull()
    expect(snapshot?.currentBranch).toBe("main")
    expect(snapshot?.dirty).toBe(true)
    expect(snapshot?.worktrees.map((worktree) => worktree.branch)).toEqual(["main", "integration"])
    expect(context).toContain("--- LIVE GIT PREFLIGHT ---")
    expect(context).toContain("Current branch: main")
    expect(context).toContain("Current worktree dirty: yes")
    expect(context).toContain("Worktrees (2)")
    expect(context).toContain("branch=integration")
    expect(context).toContain("Before any repository-wide status")
    expect(context).toContain("authoritative task boards")
    expect(context).toContain("memory, or a handoff alone")
    expect(bundle.metadata.gitScope).toMatchObject({
      repository: "repo",
      currentBranch: "main",
      dirty: true,
    })
    expect(bundle.metadata.gitScope?.worktrees.map((worktree) => worktree.name)).toEqual([
      "repo",
      "repo-integration",
    ])
    expect(JSON.stringify(bundle.metadata.gitScope)).not.toContain(rootPath)
  })
})
