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
import {
  applyNativeExtensionMutation,
  extensionCapabilityRegistry,
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

  it.each([
    ["claude-agent.md", target("claude-code", "custom-agent", "user", "reviewer"), ["x-provider"]],
    ["codex-skill.md", target("codex", "skill", "user", "release-check"), ["future-field"]],
    ["cursor-command.md", target("cursor-agent", "command", "project", "review"), []],
  ] as const)("round-trips %s byte-for-byte", (fixture, extensionTarget, unknownFields) => {
    const raw = readFileSync(join(fixtureRoot, fixture), "utf8")
    const parsed = parseNativeExtensionContent(extensionTarget, raw)

    expect(parsed.unknownFields).toEqual(unknownFields)
    expect(serializeNativeExtensionDocument(parsed)).toBe(raw)
  })

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
    expect(preview.unknownFields).toEqual(["x-provider"])
    expect(preview.diff).toContain("Review code safely")
    expect(readFileSync(file, "utf8")).toBe(original)

    const result = await applyNativeExtensionMutation(
      { ...mutation, expectedHash: preview.beforeHash },
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
    symlinkSync(outside, join(home, ".agents", "skills", "linked"))

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
        { ...mutation, expectedHash: preview.beforeHash },
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
        { ...mutation, expectedHash: preview.beforeHash },
        { homeDir: home },
      ),
    ).rejects.toThrow("changed after preview")
    expect(readFileSync(file, "utf8")).toBe(external)
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
        { ...mutation, expectedHash: preview.beforeHash },
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
      { operation: "delete", target: extensionTarget, expectedHash: deletePreview.beforeHash },
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
      { ...createMutation, expectedHash: createPreview.beforeHash },
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
      { ...mutation, expectedHash: preview.beforeHash },
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
