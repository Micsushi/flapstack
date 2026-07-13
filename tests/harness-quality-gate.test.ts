import { execFileSync } from "node:child_process"
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { buildHarnessContextBundle } from "../src/main/lib/harness/launch-context"

type QualityFixture = {
  name: string
  prompt: string
  authoritativeTaskFile: string
  expected: {
    completed: number
    total: number
    remaining: number
    integrationBranch: string
  }
  providers: Array<"codex" | "claude-code" | "cursor-agent" | "openrouter" | "nanogpt">
}

const fixture = JSON.parse(
  readFileSync(
    join(process.cwd(), "tests/fixtures/harness-quality/multi-worktree-progress.json"),
    "utf8",
  ),
) as QualityFixture

const harnessByProvider = {
  codex: "codex",
  "claude-code": "claude-code",
  "cursor-agent": "cursor-agent",
  openrouter: "opencode",
  nanogpt: "opencode",
} as const

let rootPath: string
let repositoryPath: string
let integrationPath: string

beforeEach(() => {
  rootPath = join(tmpdir(), `flapstack-harness-quality-${crypto.randomUUID()}`)
  repositoryPath = join(rootPath, "repository")
  integrationPath = join(rootPath, "repository-integration")
  mkdirSync(repositoryPath, { recursive: true })
  writeFileSync(join(repositoryPath, "README.md"), "synthetic quality fixture\n")
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
  execFileSync("git", ["branch", fixture.expected.integrationBranch], {
    cwd: repositoryPath,
  })
  execFileSync("git", ["worktree", "add", integrationPath, fixture.expected.integrationBranch], {
    cwd: repositoryPath,
  })
  writeFileSync(
    join(integrationPath, fixture.authoritativeTaskFile),
    JSON.stringify(fixture.expected, null, 2),
  )
})

afterEach(() => {
  rmSync(rootPath, { recursive: true, force: true })
})

describe("multi-provider harness quality gate", () => {
  it("keeps the synthetic hard facts internally consistent", () => {
    expect(fixture.expected.completed + fixture.expected.remaining).toBe(fixture.expected.total)
    expect(fixture.providers).toEqual([
      "codex",
      "claude-code",
      "cursor-agent",
      "openrouter",
      "nanogpt",
    ])
  })

  it.each(fixture.providers)("gives %s live multi-worktree evidence", async (provider) => {
    const initialBundle = await buildHarnessContextBundle({
      cwd: repositoryPath,
      harness: harnessByProvider[provider],
      userPrompt: fixture.prompt,
      sessionMode: "new",
      vaultConfigPath: join(rootPath, "missing-launch-context.json"),
    })
    const bundle = await buildHarnessContextBundle({
      cwd: repositoryPath,
      harness: harnessByProvider[provider],
      userPrompt: fixture.prompt,
      sessionMode: "resumed",
      previousSourceFingerprint: initialBundle.metadata.sourceFingerprint,
      vaultConfigPath: join(rootPath, "missing-launch-context.json"),
    })

    expect(bundle.context).toContain("Worktrees (2)")
    expect(bundle.context).toContain(`branch=${fixture.expected.integrationBranch}`)
    expect(bundle.context).toContain("authoritative task boards")
    expect(bundle.context).not.toContain("Loaded context:")
    expect(bundle.context.length).toBeLessThan(4_000)
    expect(bundle.metadata.mode).toBe("resumed")
    expect(bundle.metadata.gitScope?.worktrees).toHaveLength(2)
    expect(bundle.metadata.gitScope?.worktrees.map((worktree) => worktree.branch)).toEqual([
      "main",
      fixture.expected.integrationBranch,
    ])
  })
})
