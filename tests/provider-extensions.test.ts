import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import matter from "gray-matter"
import { afterEach, describe, expect, it } from "vitest"
import {
  discoverProviderExtensions,
  mutateProviderExtension,
  providerExtensionId,
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
  it("keeps same-name extensions distinct by provider, kind, and source identity", async () => {
    const home = temporaryRoot()
    const cwd = join(home, "project")
    write(join(home, ".claude", "skills", "review", "SKILL.md"), skill("review"))
    write(join(home, ".agents", "skills", "review", "SKILL.md"), skill("review"))
    write(join(cwd, ".cursor", "commands", "review.md"), "Review the current changes.")
    write(join(cwd, ".opencode", "skills", "review", "SKILL.md"), skill("review"))

    const inventory = await discoverProviderExtensions({ cwd, homeDir: home })
    const review = inventory.filter((item) => item.name === "review")

    expect(review).toHaveLength(4)
    expect(new Set(review.map((item) => item.id)).size).toBe(4)
    expect(review.map((item) => `${item.provider}:${item.kind}`).sort()).toEqual([
      "claude:skill",
      "codex:skill",
      "cursor:command",
      "opencode:skill",
    ])
  })

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

  it("discovers third-party MCP entries but excludes Flapstack product identities", async () => {
    const home = temporaryRoot()
    write(
      join(home, ".codex", "config.toml"),
      '[mcp_servers."third-party"]\ncommand = "example"\n\n[mcp_servers.flapstack]\ncommand = "internal"\n',
    )

    const mcp = (await discoverProviderExtensions({ homeDir: home })).filter(
      (item) => item.provider === "codex" && item.kind === "mcp",
    )
    expect(mcp.map((item) => item.name)).toEqual(["third-party"])
    expect(mcp[0]?.description).toBe("Third-party provider MCP configuration")
  })

  it("refresh removes stale entries without touching provider files", async () => {
    const home = temporaryRoot()
    const file = join(home, ".agents", "skills", "release", "SKILL.md")
    write(file, skill("release"))
    expect(
      (await discoverProviderExtensions({ homeDir: home })).some((item) => item.name === "release"),
    ).toBe(true)

    rmSync(file)
    expect(
      (await discoverProviderExtensions({ homeDir: home })).some((item) => item.name === "release"),
    ).toBe(false)
  })

  it("fails one oversized provider file closed without hiding valid siblings", async () => {
    const home = temporaryRoot()
    write(join(home, ".agents", "skills", "valid", "SKILL.md"), skill("valid"))
    write(
      join(home, ".agents", "skills", "oversized", "SKILL.md"),
      `---\nname: oversized\ndescription: oversized\n---\n\n${"x".repeat(1_000_001)}`,
    )

    const inventory = await discoverProviderExtensions({ homeDir: home })
    expect(inventory.some((item) => item.name === "valid")).toBe(true)
    expect(inventory.find((item) => item.name === "oversized")?.capabilities).toMatchObject({
      discovery: "unknown",
      update: false,
      runtime: "unknown",
    })
  })
})

describe("provider extension mutations", () => {
  it("creates and updates only the exact provider-scoped runtime path", async () => {
    const home = temporaryRoot()
    const created = await mutateProviderExtension(
      {
        operation: "create",
        provider: "codex",
        kind: "skill",
        source: "user",
        name: "release-check",
        description: "Check a release",
        content: "Run the release checks.",
      },
      { homeDir: home },
    )

    const codexPath = join(home, ".agents", "skills", "release-check", "SKILL.md")
    const claudePath = join(home, ".claude", "skills", "release-check", "SKILL.md")
    expect(created.id).toBe(providerExtensionId("codex", "skill", codexPath))
    expect(readFileSync(codexPath, "utf8")).toContain("Run the release checks.")
    expect(() => readFileSync(claudePath, "utf8")).toThrow()

    await mutateProviderExtension(
      {
        operation: "update",
        provider: "codex",
        kind: "skill",
        source: "user",
        sourceId: codexPath,
        name: "release-check",
        description: "Check a release safely",
        content: "Run verified release checks.",
      },
      { homeDir: home },
    )
    expect(readFileSync(codexPath, "utf8")).toContain("Run verified release checks.")
  })

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

  it("deletes the complete skill directory, including provider-owned assets", async () => {
    const home = temporaryRoot()
    const skillRoot = join(home, ".agents", "skills", "with-assets")
    const skillPath = join(skillRoot, "SKILL.md")
    write(skillPath, skill("with-assets"))
    write(join(skillRoot, "references", "details.md"), "Provider-owned reference")

    await mutateProviderExtension(
      {
        operation: "delete",
        provider: "codex",
        kind: "skill",
        source: "user",
        sourceId: skillPath,
        name: "with-assets",
        description: "delete all provider-owned files",
        content: "",
      },
      { homeDir: home },
    )

    expect(existsSync(skillRoot)).toBe(false)
  })

  it("preserves provider-specific frontmatter during an update", async () => {
    const home = temporaryRoot()
    const agentPath = join(home, ".claude", "agents", "reviewer.md")
    write(
      agentPath,
      "---\ndescription: Review code\nmodel: opus\ntools: Read, Grep\n---\n\nReview carefully.\n",
    )

    await mutateProviderExtension(
      {
        operation: "update",
        provider: "claude",
        kind: "custom-agent",
        source: "user",
        sourceId: agentPath,
        name: "reviewer",
        description: "Review code safely",
        content: "Review carefully and report risks.",
      },
      { homeDir: home },
    )

    const updated = matter(readFileSync(agentPath, "utf8"))
    expect(updated.data).toMatchObject({
      name: "reviewer",
      model: "opus",
      tools: "Read, Grep",
    })
    expect(updated.content).toContain("Review carefully and report risks.")
  })

  it("does not invent write support for read-only provider kinds", async () => {
    const home = temporaryRoot()
    await expect(
      mutateProviderExtension(
        {
          operation: "create",
          provider: "cursor",
          kind: "plugin",
          source: "user",
          name: "unsafe-plugin",
          description: "",
          content: "export default {}",
        },
        { homeDir: home },
      ),
    ).rejects.toThrow("is not supported")

    await expect(
      mutateProviderExtension(
        {
          operation: "create",
          provider: "opencode",
          kind: "skill",
          source: "user",
          name: "not-injected",
          description: "Must not claim runtime support",
          content: "Not consumed by managed sidecars.",
        },
        { homeDir: home },
      ),
    ).rejects.toThrow("is not supported")
  })

  it("rejects nested symlinks that escape a provider root", async () => {
    const home = temporaryRoot()
    const outside = temporaryRoot()
    const root = join(home, ".agents", "skills")
    mkdirSync(root, { recursive: true })
    symlinkSync(outside, join(root, "escaped"))

    await expect(
      mutateProviderExtension(
        {
          operation: "update",
          provider: "codex",
          kind: "skill",
          source: "user",
          sourceId: join(root, "escaped", "SKILL.md"),
          name: "escaped",
          description: "escape",
          content: "escape",
        },
        { homeDir: home },
      ),
    ).rejects.toThrow("symbolic-link boundary")
  })
})

function skill(name: string): string {
  return `---\nname: ${name}\ndescription: ${name} description\n---\n\n${name} body\n`
}
