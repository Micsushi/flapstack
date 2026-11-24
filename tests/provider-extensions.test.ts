import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  discoverProviderExtensions,
  mutateProviderExtension,
} from "../src/main/lib/provider-extensions"

const temporaryRoots: string[] = []

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "flapstack-provider-extensions-"))
  temporaryRoots.push(root)
  return root
}

function write(file: string, content: string): void {
  mkdirSync(join(file, ".."), { recursive: true })
  writeFileSync(file, content)
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("provider extension contracts", () => {
  it("fails closed for unknown MCP config instead of exposing mutation", async () => {
    const home = temporaryRoot()
    write(join(home, ".cursor", "mcp.json"), "{not-json")

    const [failure] = (await discoverProviderExtensions({ homeDir: home })).filter(
      (item) => item.provider === "cursor" && item.kind === "mcp",
    )

    expect(failure).toMatchObject({
      name: "Unreadable MCP configuration",
      capabilities: {
        discovery: "unknown",
        create: false,
        update: false,
        delete: false,
        runtime: "unknown",
      },
    })
  })
})

describe("provider extension mutations", () => {
  it("rejects a cross-provider identity and preserves the prior file", async () => {
    const home = temporaryRoot()
    const claudePath = join(home, ".claude", "skills", "shared", "SKILL.md")
    write(claudePath, skill("shared"))

    await expect(
      mutateProviderExtension(
        {
          operation: "update",
          provider: "codex",
          kind: "skill",
          source: "user",
          sourceId: claudePath,
          name: "shared",
          description: "wrong target",
          content: "wrong target",
        },
        { homeDir: home },
      ),
    ).rejects.toThrow("identity does not match")
    expect(readFileSync(claudePath, "utf8")).toBe(skill("shared"))
  })

  it("revalidates the rooted parent after validation and before commit", async () => {
    const home = temporaryRoot()
    const outside = temporaryRoot()
    const skillRoot = join(home, ".agents", "skills", "raced")
    const outsideFile = join(outside, "SKILL.md")
    write(join(skillRoot, "SKILL.md"), skill("raced"))
    write(outsideFile, skill("outside"))

    await expect(
      mutateProviderExtension(
        {
          operation: "update",
          provider: "codex",
          kind: "skill",
          source: "user",
          sourceId: join(skillRoot, "SKILL.md"),
          name: "raced",
          description: "must stay rooted",
          content: "must not escape",
        },
        {
          homeDir: home,
          beforeCommit: () => {
            rmSync(skillRoot, { recursive: true })
            symlinkSync(outside, skillRoot, process.platform === "win32" ? "junction" : "dir")
          },
        },
      ),
    ).rejects.toThrow("Write parent changed during commit")
    expect(readFileSync(outsideFile, "utf8")).toBe(skill("outside"))
  })
})

function skill(name: string): string {
  return `---\nname: ${name}\ndescription: ${name} description\n---\n\n${name} body\n`
}
