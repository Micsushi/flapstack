import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import matter from "gray-matter"
import { afterEach, describe, expect, it } from "vitest"
import { fileSymlinksSupported } from "./helpers/symlink-capability"
import {
  applyNativeExtensionMutation,
  extensionCapabilityRegistry,
  getNativeExtensionAdapterDescriptor,
  nativeExtensionAdapterRegistry,
  parseNativeExtensionContent,
  previewNativeExtensionMutation,
  readNativeExtension,
  restoreNativeExtensionBackup,
  serializeNativeExtensionDocument,
  type NativeExtensionTarget,
} from "../src/main/lib/extension-management"

const temporaryRoots: string[] = []
const fixtureRoot = join(process.cwd(), "tests", "fixtures", "extension-management", "native")
const pinnedFormatFixtures = {
  "claude-code:skill": ["claude-skill.md", "review", ["future-field"]],
  "claude-code:command": ["claude-command.md", "review", ["x-command"]],
  "claude-code:custom-agent": ["claude-agent.md", "reviewer", ["x-provider"]],
  "codex:skill": ["codex-skill.md", "release-check", ["future-field"]],
  "codex:command": ["codex-command.md", "review", ["x-codex"]],
  "cursor-agent:command": ["cursor-command.md", "review", []],
} as const

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("native extension adapter parsing", () => {
  it("covers every registry-owned mutable Markdown capability without inventing MCP adapters", () => {
    const expected = extensionCapabilityRegistry
      .filter(
        (capability) =>
          capability.mutations.length > 0 &&
          capability.kind !== "mcp" &&
          capability.kind !== "hook" &&
          capability.scope !== "plugin",
      )
      .map((capability) => capability.id)
      .sort()

    expect(nativeExtensionAdapterRegistry.map((entry) => entry.capabilityId).sort()).toEqual(
      expected,
    )
  })

  it.each(nativeExtensionAdapterRegistry)(
    "round-trips pinned $capabilityId format byte-for-byte",
    (registration) => {
      const fixtureKey =
        `${registration.harness}:${registration.kind}` as keyof typeof pinnedFormatFixtures
      const [fixture, name, unknownFields] = pinnedFormatFixtures[fixtureKey]
      const extensionTarget = target(
        registration.harness,
        registration.kind,
        registration.scope,
        name,
        registration.scope === "project" ? "/tmp/project" : undefined,
      )
      const raw = readFileSync(join(fixtureRoot, fixture), "utf8")
      const parsed = parseNativeExtensionContent(extensionTarget, raw)

      expect(parsed.unknownFields).toEqual(unknownFields)
      expect(serializeNativeExtensionDocument(parsed)).toBe(raw)
    },
  )

  it("pins current Claude skill and custom-agent frontmatter fields", () => {
    expect(
      getNativeExtensionAdapterDescriptor(target("claude-code", "skill", "user", "review"))
        .knownFields,
    ).toEqual(
      expect.arrayContaining([
        "when_to_use",
        "arguments",
        "disallowed-tools",
        "effort",
        "context",
        "hooks",
        "paths",
        "shell",
      ]),
    )
    expect(
      getNativeExtensionAdapterDescriptor(target("claude-code", "custom-agent", "user", "reviewer"))
        .knownFields,
    ).toEqual(
      expect.arrayContaining([
        "disallowedTools",
        "permissionMode",
        "maxTurns",
        "skills",
        "mcpServers",
        "hooks",
        "memory",
        "background",
        "effort",
        "isolation",
        "color",
        "initialPrompt",
      ]),
    )
  })

  it.each(["default", "acceptEdits", "auto", "dontAsk", "bypassPermissions", "plan"])(
    "accepts pinned Claude custom-agent permission mode %s",
    (permissionMode) => {
      expect(() =>
        parseNativeExtensionContent(
          target("claude-code", "custom-agent", "user", "reviewer"),
          `---\nname: reviewer\ndescription: Review safely\npermissionMode: ${permissionMode}\n---\n\nbody\n`,
        ),
      ).not.toThrow()
    },
  )

  it("rejects malformed and schema-invalid provider files", () => {
    const skillTarget = target("codex", "skill", "user", "broken")
    expect(() =>
      parseNativeExtensionContent(
        skillTarget,
        "---\nname: broken\nitems: [unterminated\n---\nbody",
      ),
    ).toThrow("frontmatter is malformed")
    expect(() =>
      parseNativeExtensionContent(skillTarget, "---\nname: broken\n---\n\nbody\n"),
    ).toThrow()
    expect(() =>
      parseNativeExtensionContent(
        target("claude-code", "custom-agent", "user", "broken"),
        "---\ndescription: Missing native agent name\n---\n\nbody\n",
      ),
    ).toThrow("metadata schema is invalid")
    expect(() =>
      parseNativeExtensionContent(
        target("claude-code", "custom-agent", "user", "reviewer"),
        "---\nname: reviewer\ndescription: Review safely\npermissionMode: manual\n---\n\nbody\n",
      ),
    ).toThrow("metadata schema is invalid")
  })
})

describe("native extension mutation safety", () => {
  it("previews exact changes, retains unknown fields, writes a backup, and restores exact bytes", async () => {
    const home = temporaryRoot()
    const extensionTarget = target("claude-code", "custom-agent", "user", "reviewer")
    const file = join(home, ".claude", "agents", "reviewer.md")
    const original = readFileSync(join(fixtureRoot, "claude-agent.md"), "utf8")
    write(file, original)

    const mutation = {
      operation: "update" as const,
      target: extensionTarget,
      changes: { metadata: { description: "Review code safely" } },
    }
    const preview = await previewNativeExtensionMutation(mutation, { homeDir: home })

    expect(preview.changed).toBe(true)
    expect(preview.beforeHash).toHaveLength(64)
    expect(preview.afterHash).toHaveLength(64)
    expect(preview.confirmationHash).toHaveLength(64)
    expect(preview.unknownFields).toEqual(["x-provider"])
    expect(preview.diff).toContain("Review code safely")
    expect(readFileSync(file, "utf8")).toBe(original)

    const result = await applyNativeExtensionMutation(
      {
        ...mutation,
        expectedHash: preview.beforeHash,
        confirmationHash: preview.confirmationHash,
      },
      { homeDir: home },
    )
    const updated = matter(readFileSync(file, "utf8"))
    expect(updated.data).toMatchObject({
      description: "Review code safely",
      model: "opus",
      tools: ["Read", "Grep"],
      "x-provider": { color: "purple", retries: 2 },
    })
    expect(result.backup?.relativePath).toContain(".flapstack-backups")
    expect(existsSync(join(home, result.backup!.relativePath))).toBe(true)

    const restored = await restoreNativeExtensionBackup(
      { target: extensionTarget, backupId: result.backup!.backupId },
      { homeDir: home },
    )
    expect(restored.restoredHash).toBe(preview.beforeHash)
    expect(readFileSync(file, "utf8")).toBe(original)
  })

  it("fails malformed mutation input before creating a backup or changing the file", async () => {
    const home = temporaryRoot()
    const extensionTarget = target("codex", "skill", "user", "broken")
    const file = join(home, ".agents", "skills", "broken", "SKILL.md")
    const malformed = "---\nname: broken\nitems: [unterminated\n---\nbody"
    write(file, malformed)

    await expect(
      previewNativeExtensionMutation(
        {
          operation: "update",
          target: extensionTarget,
          changes: { content: "changed" },
        },
        { homeDir: home },
      ),
    ).rejects.toThrow(/frontmatter is malformed|metadata schema is invalid/)
    expect(readFileSync(file, "utf8")).toBe(malformed)
    expect(existsSync(join(home, ".agents", "skills", ".flapstack-backups"))).toBe(false)
  })

  it("rejects traversal and symlink escapes before native or backup writes", async () => {
    const home = temporaryRoot()
    const outside = temporaryRoot()
    write(join(outside, "SKILL.md"), validSkill("outside"))
    mkdirSync(join(home, ".agents", "skills"), { recursive: true })
    symlinkSync(
      outside,
      join(home, ".agents", "skills", "linked"),
      process.platform === "win32" ? "junction" : "dir",
    )

    await expect(
      previewNativeExtensionMutation(
        {
          operation: "update",
          target: target("codex", "skill", "user", "linked"),
          changes: { content: "escaped" },
        },
        { homeDir: home },
      ),
    ).rejects.toThrow("symbolic link")
    expect(readFileSync(join(outside, "SKILL.md"), "utf8")).toBe(validSkill("outside"))
    expect(existsSync(join(home, ".agents", "skills", ".flapstack-backups"))).toBe(false)

    if (fileSymlinksSupported) {
      const outsideCommand = join(outside, "review.md")
      const linkedCommand = join(home, ".cursor", "commands", "review.md")
      write(outsideCommand, "Review outside.\n")
      mkdirSync(dirname(linkedCommand), { recursive: true })
      symlinkSync(outsideCommand, linkedCommand)
      await expect(
        previewNativeExtensionMutation(
          {
            operation: "update",
            target: target("cursor-agent", "command", "project", "review", home),
            changes: { content: "escaped" },
          },
          { homeDir: home },
        ),
      ).rejects.toThrow("symbolic link")
      expect(readFileSync(outsideCommand, "utf8")).toBe("Review outside.\n")
    }

    await expect(
      previewNativeExtensionMutation(
        {
          operation: "create",
          target: target("codex", "skill", "user", "../../escaped"),
          changes: {
            metadata: { name: "escaped", description: "escaped" },
            content: "escaped",
          },
        },
        { homeDir: home },
      ),
    ).rejects.toThrow("lowercase letters")
  })

  it("rolls a committed update back when post-commit verification fails", async () => {
    const home = temporaryRoot()
    const extensionTarget = target("codex", "skill", "user", "release-check")
    const file = join(home, ".agents", "skills", "release-check", "SKILL.md")
    const original = validSkill("release-check")
    write(file, original)
    const mutation = {
      operation: "update" as const,
      target: extensionTarget,
      changes: { content: "changed body\n" },
    }
    const preview = await previewNativeExtensionMutation(mutation, { homeDir: home })

    await expect(
      applyNativeExtensionMutation(
        {
          ...mutation,
          expectedHash: preview.beforeHash,
          confirmationHash: preview.confirmationHash,
        },
        {
          homeDir: home,
          afterCommit: () => {
            throw new Error("simulated verification failure")
          },
        },
      ),
    ).rejects.toThrow("simulated verification failure")

    expect(readFileSync(file, "utf8")).toBe(original)
    expect(listFiles(home).every((item) => !item.includes(".tmp"))).toBe(true)
  })

  it("rejects a stale preview without writing a backup", async () => {
    const home = temporaryRoot()
    const extensionTarget = target("codex", "skill", "user", "release-check")
    const file = join(home, ".agents", "skills", "release-check", "SKILL.md")
    write(file, validSkill("release-check"))
    const mutation = {
      operation: "update" as const,
      target: extensionTarget,
      changes: { content: "previewed\n" },
    }
    const preview = await previewNativeExtensionMutation(mutation, { homeDir: home })
    const external = validSkill("release-check").replace("body", "external")
    writeFileSync(file, external)

    await expect(
      applyNativeExtensionMutation(
        {
          ...mutation,
          expectedHash: preview.beforeHash,
          confirmationHash: preview.confirmationHash,
        },
        { homeDir: home },
      ),
    ).rejects.toThrow("changed after preview")
    expect(readFileSync(file, "utf8")).toBe(external)
    expect(existsSync(join(home, ".agents", "skills", ".flapstack-backups"))).toBe(false)
  })

  it("binds apply to the exact reviewed preview payload", async () => {
    const home = temporaryRoot()
    const extensionTarget = target("codex", "skill", "user", "release-check")
    const file = join(home, ".agents", "skills", "release-check", "SKILL.md")
    const original = validSkill("release-check")
    write(file, original)
    const reviewed = {
      operation: "update" as const,
      target: extensionTarget,
      changes: { content: "reviewed body\n" },
    }
    const preview = await previewNativeExtensionMutation(reviewed, { homeDir: home })

    await expect(
      applyNativeExtensionMutation(
        {
          ...reviewed,
          changes: { content: "different unreviewed body\n" },
          expectedHash: preview.beforeHash,
          confirmationHash: preview.confirmationHash,
        },
        { homeDir: home },
      ),
    ).rejects.toThrow("preview confirmation is stale or invalid")
    expect(readFileSync(file, "utf8")).toBe(original)
    expect(existsSync(join(home, ".agents", "skills", ".flapstack-backups"))).toBe(false)
  })

  it("rejects an external in-place edit between backup and atomic commit", async () => {
    const home = temporaryRoot()
    const extensionTarget = target("codex", "skill", "user", "release-check")
    const file = join(home, ".agents", "skills", "release-check", "SKILL.md")
    write(file, validSkill("release-check"))
    const mutation = {
      operation: "update" as const,
      target: extensionTarget,
      changes: { content: "adapter update\n" },
    }
    const preview = await previewNativeExtensionMutation(mutation, { homeDir: home })
    const external = validSkill("release-check").replace("body", "external during commit")

    await expect(
      applyNativeExtensionMutation(
        {
          ...mutation,
          expectedHash: preview.beforeHash,
          confirmationHash: preview.confirmationHash,
        },
        {
          homeDir: home,
          beforeCommit: () => writeFileSync(file, external),
        },
      ),
    ).rejects.toThrow("changed during commit")
    expect(readFileSync(file, "utf8")).toBe(external)
  })

  it("backs up and restores deletes and creations without touching sibling assets", async () => {
    const home = temporaryRoot()
    const extensionTarget = target("codex", "skill", "user", "asset-skill")
    const file = join(home, ".agents", "skills", "asset-skill", "SKILL.md")
    const asset = join(home, ".agents", "skills", "asset-skill", "references", "detail.md")
    const original = validSkill("asset-skill")
    write(file, original)
    write(asset, "asset stays")

    const deletePreview = await previewNativeExtensionMutation(
      { operation: "delete", target: extensionTarget },
      { homeDir: home },
    )
    const deleted = await applyNativeExtensionMutation(
      {
        operation: "delete",
        target: extensionTarget,
        expectedHash: deletePreview.beforeHash,
        confirmationHash: deletePreview.confirmationHash,
      },
      { homeDir: home },
    )
    expect(existsSync(file)).toBe(false)
    expect(readFileSync(asset, "utf8")).toBe("asset stays")
    await restoreNativeExtensionBackup(
      { target: extensionTarget, backupId: deleted.backup!.backupId },
      { homeDir: home },
    )
    expect(readFileSync(file, "utf8")).toBe(original)

    const createdTarget = target("cursor-agent", "command", "project", "review", home)
    const createMutation = {
      operation: "create" as const,
      target: createdTarget,
      changes: { content: "Review only.\n" },
    }
    const createPreview = await previewNativeExtensionMutation(createMutation, { homeDir: home })
    const created = await applyNativeExtensionMutation(
      {
        ...createMutation,
        expectedHash: createPreview.beforeHash,
        confirmationHash: createPreview.confirmationHash,
      },
      { homeDir: home },
    )
    expect(await readNativeExtension(createdTarget, { homeDir: home })).toMatchObject({
      content: "Review only.\n",
    })
    await restoreNativeExtensionBackup(
      { target: createdTarget, backupId: created.backup!.backupId },
      { homeDir: home },
    )
    expect(existsSync(join(home, ".cursor", "commands", "review.md"))).toBe(false)
  })

  it("rejects malformed backups, stale restores, and registry-unsupported mutations", async () => {
    const home = temporaryRoot()
    const extensionTarget = target("codex", "skill", "user", "release-check")
    const file = join(home, ".agents", "skills", "release-check", "SKILL.md")
    write(file, validSkill("release-check"))
    const mutation = {
      operation: "update" as const,
      target: extensionTarget,
      changes: { content: "updated\n" },
    }
    const preview = await previewNativeExtensionMutation(mutation, { homeDir: home })
    const result = await applyNativeExtensionMutation(
      {
        ...mutation,
        expectedHash: preview.beforeHash,
        confirmationHash: preview.confirmationHash,
      },
      { homeDir: home },
    )
    const updated = readFileSync(file, "utf8")

    const external = validSkill("release-check").replace("body", "external after backup")
    writeFileSync(file, external)
    await expect(
      restoreNativeExtensionBackup(
        { target: extensionTarget, backupId: result.backup!.backupId },
        { homeDir: home },
      ),
    ).rejects.toThrow("refusing stale restore")
    expect(readFileSync(file, "utf8")).toBe(external)

    writeFileSync(file, updated)
    writeFileSync(join(home, result.backup!.relativePath), "not json")

    await expect(
      restoreNativeExtensionBackup(
        { target: extensionTarget, backupId: result.backup!.backupId },
        { homeDir: home },
      ),
    ).rejects.toThrow("backup is malformed")
    expect(readFileSync(file, "utf8")).toBe(updated)

    await expect(
      previewNativeExtensionMutation(
        {
          operation: "create",
          target: target("opencode", "skill", "user", "unsupported"),
          changes: {
            metadata: { name: "unsupported", description: "unsupported" },
            content: "unsupported",
          },
        },
        { homeDir: home },
      ),
    ).rejects.toThrow("is not supported")

    await expect(
      previewNativeExtensionMutation(
        {
          operation: "create",
          target: target("claude-code", "mcp", "user", "server"),
          changes: { content: "{}" },
        },
        { homeDir: home },
      ),
    ).rejects.toThrow("No native file adapter")
  })

  it("rejects a valid backup record rebound to a different native target", async () => {
    const home = temporaryRoot()
    const firstTarget = target("codex", "skill", "user", "first-skill")
    const secondTarget = target("codex", "skill", "user", "second-skill")
    const firstFile = join(home, ".agents", "skills", "first-skill", "SKILL.md")
    const secondFile = join(home, ".agents", "skills", "second-skill", "SKILL.md")
    write(firstFile, validSkill("first-skill"))
    write(secondFile, validSkill("second-skill"))

    const firstMutation = {
      operation: "update" as const,
      target: firstTarget,
      changes: { content: "first updated\n" },
    }
    const secondMutation = {
      operation: "update" as const,
      target: secondTarget,
      changes: { content: "second updated\n" },
    }
    const firstPreview = await previewNativeExtensionMutation(firstMutation, { homeDir: home })
    const secondPreview = await previewNativeExtensionMutation(secondMutation, { homeDir: home })
    const firstResult = await applyNativeExtensionMutation(
      {
        ...firstMutation,
        expectedHash: firstPreview.beforeHash,
        confirmationHash: firstPreview.confirmationHash,
      },
      { homeDir: home },
    )
    const secondResult = await applyNativeExtensionMutation(
      {
        ...secondMutation,
        expectedHash: secondPreview.beforeHash,
        confirmationHash: secondPreview.confirmationHash,
      },
      { homeDir: home },
    )
    const rebound = JSON.parse(
      readFileSync(join(home, firstResult.backup!.relativePath), "utf8"),
    ) as { backupId: string }
    rebound.backupId = secondResult.backup!.backupId
    writeFileSync(join(home, secondResult.backup!.relativePath), `${JSON.stringify(rebound)}\n`)

    await expect(
      restoreNativeExtensionBackup(
        { target: secondTarget, backupId: secondResult.backup!.backupId },
        { homeDir: home },
      ),
    ).rejects.toThrow("does not match the requested target")
    expect(readFileSync(secondFile, "utf8")).toContain("second updated")
  })
})

function target(
  harness: NativeExtensionTarget["harness"],
  kind: NativeExtensionTarget["kind"],
  scope: NativeExtensionTarget["scope"],
  name: string,
  cwd?: string,
): NativeExtensionTarget {
  return { harness, kind, scope, name, cwd }
}

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "flapstack-native-adapter-"))
  temporaryRoots.push(root)
  return root
}

function write(file: string, content: string): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, content)
}

function validSkill(name: string): string {
  return `---\nname: ${name}\ndescription: ${name} description\n---\n\nbody\n`
}

function listFiles(root: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const file = join(root, entry.name)
    if (entry.isFile()) files.push(file)
    if (entry.isDirectory() && !entry.isSymbolicLink()) files.push(...listFiles(file))
  }
  return files
}
