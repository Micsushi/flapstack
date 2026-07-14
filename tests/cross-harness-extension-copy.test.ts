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
import { dirname, join } from "node:path"
import matter from "gray-matter"
import { afterEach, describe, expect, it } from "vitest"
import {
  applyCrossHarnessCopy,
  previewCrossHarnessCopy,
  sanitizePortableExtensionManifest,
  type CrossHarnessCopyApplyInput,
  type CrossHarnessCopyPreview,
  type NativeExtensionTarget,
} from "../src/main/lib/extension-management"

const temporaryRoots: string[] = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("cross-harness extension copy", () => {
  it.each([
    ["claude-code", "codex", ".claude", ".agents"],
    ["codex", "claude-code", ".agents", ".claude"],
  ] as const)(
    "copies a skill from %s to %s only after confirmed preview",
    async (sourceHarness, targetHarness, sourceRoot, targetRoot) => {
      const home = temporaryRoot()
      const source = target(sourceHarness, "skill", "user", "release-check")
      const destination = target(targetHarness, "skill", "user", "release-check")
      const sourceFile = join(home, sourceRoot, "skills", "release-check", "SKILL.md")
      const targetFile = join(home, targetRoot, "skills", "release-check", "SKILL.md")
      const original = validSkill("release-check")
      write(sourceFile, original)

      const preview = await previewCrossHarnessCopy(
        { source, target: destination, collisionPolicy: "reject" },
        { homeDir: home },
      )

      expect(preview).toMatchObject({
        status: "exact",
        canApply: true,
        sourceCapability: { harness: sourceHarness, kind: "skill", scope: "user" },
        targetCapability: { harness: targetHarness, kind: "skill", scope: "user" },
        collision: { exists: false, action: "create" },
      })
      expect(preview.targetDiff).toContain("release-check description")
      expect(preview.confirmationHash).toHaveLength(64)
      expect(existsSync(targetFile)).toBe(false)
      expect(readFileSync(sourceFile, "utf8")).toBe(original)

      const serializedManifest = JSON.stringify(preview.portableManifest)
      expect(serializedManifest).not.toContain(home)
      expect(serializedManifest).not.toContain("cwd")
      expect(serializedManifest).not.toContain("path")
      expect(serializedManifest).not.toContain("hash")

      const result = await applyCrossHarnessCopy(confirmed(preview, source, destination), {
        homeDir: home,
      })

      expect(result.sourcePreserved).toBe(true)
      expect(readFileSync(sourceFile, "utf8")).toBe(original)
      expect(matter(readFileSync(targetFile, "utf8"))).toMatchObject({
        data: { name: "release-check", description: "release-check description" },
        content: "\nbody\n",
      })
    },
  )

  it("marks renames converted and preserves the source", async () => {
    const home = temporaryRoot()
    const source = target("claude-code", "skill", "user", "source-skill")
    const destination = target("codex", "skill", "user", "shared-skill")
    const sourceFile = join(home, ".claude", "skills", "source-skill", "SKILL.md")
    write(sourceFile, validSkill("source-skill"))

    const preview = await previewCrossHarnessCopy(
      { source, target: destination, collisionPolicy: "reject" },
      { homeDir: home },
    )

    expect(preview.status).toBe("converted")
    expect(preview.portableManifest?.metadata).toMatchObject({ name: "shared-skill" })
    await applyCrossHarnessCopy(confirmed(preview, source, destination), { homeDir: home })
    expect(readFileSync(sourceFile, "utf8")).toBe(validSkill("source-skill"))
  })

  it("cancels cleanly by abandoning a stateless preview", async () => {
    const home = temporaryRoot()
    const source = target("claude-code", "skill", "user", "release-check")
    const destination = target("codex", "skill", "user", "release-check")
    const sourceFile = join(home, ".claude", "skills", "release-check", "SKILL.md")
    const targetFile = join(home, ".agents", "skills", "release-check", "SKILL.md")
    const original = validSkill("release-check")
    write(sourceFile, original)

    const preview = await previewCrossHarnessCopy(
      { source, target: destination, collisionPolicy: "reject" },
      { homeDir: home },
    )

    expect(preview.canApply).toBe(true)
    expect(existsSync(targetFile)).toBe(false)
    expect(readFileSync(sourceFile, "utf8")).toBe(original)
  })

  it("reports collisions and requires overwrite confirmation", async () => {
    const home = temporaryRoot()
    const project = join(home, "project")
    const source = target("claude-code", "command", "user", "review")
    const destination = target("cursor-agent", "command", "project", "review", project)
    const sourceFile = join(home, ".claude", "commands", "review.md")
    const targetFile = join(project, ".cursor", "commands", "review.md")
    write(sourceFile, "---\ndescription: Review safely\n---\n\nnew body\n")
    write(targetFile, "---\ndescription: Old review\nx-cursor:\n  color: blue\n---\n\nold body\n")
    const originalTarget = readFileSync(targetFile, "utf8")

    const rejected = await previewCrossHarnessCopy(
      { source, target: destination, collisionPolicy: "reject" },
      { homeDir: home },
    )
    expect(rejected).toMatchObject({
      status: "exact",
      canApply: false,
      collision: { exists: true, action: "blocked" },
    })
    expect(readFileSync(targetFile, "utf8")).toBe(originalTarget)
    await expect(
      applyCrossHarnessCopy(confirmed(rejected, source, destination), { homeDir: home }),
    ).rejects.toThrow("collision policy rejects overwrite")

    const overwrite = await previewCrossHarnessCopy(
      { source, target: destination, collisionPolicy: "overwrite" },
      { homeDir: home },
    )
    expect(overwrite).toMatchObject({
      status: "exact",
      canApply: true,
      collision: { exists: true, action: "overwrite" },
      preservedTargetFields: ["x-cursor"],
    })
    expect(overwrite.targetDiff).toContain("new body")
    await applyCrossHarnessCopy(confirmed(overwrite, source, destination), { homeDir: home })
    expect(readFileSync(targetFile, "utf8")).toContain("new body")
    expect(matter(readFileSync(targetFile, "utf8")).data).toMatchObject({
      "x-cursor": { color: "blue" },
    })
  })

  it("fails closed when source fields have no target equivalent", async () => {
    const home = temporaryRoot()
    const project = join(home, "project")
    const source = target("claude-code", "command", "user", "review")
    const destination = target("cursor-agent", "command", "project", "review", project)
    const sourceFile = join(home, ".claude", "commands", "review.md")
    const targetFile = join(project, ".cursor", "commands", "review.md")
    const original =
      "---\ndescription: Review safely\nmodel: opus\nx-provider:\n  retries: 2\n---\n\nbody\n"
    write(sourceFile, original)

    const preview = await previewCrossHarnessCopy(
      { source, target: destination, collisionPolicy: "reject" },
      { homeDir: home },
    )

    expect(preview).toMatchObject({
      status: "unsupported",
      canApply: false,
      unsupportedFields: ["model", "x-provider"],
      portableManifest: null,
      confirmationHash: null,
    })
    expect(preview.reasons).toContain("Source metadata has no declared target-harness equivalent")
    expect(readFileSync(sourceFile, "utf8")).toBe(original)
    expect(existsSync(targetFile)).toBe(false)
  })

  it("fails closed when supported skill metadata nests host-only state", async () => {
    const home = temporaryRoot()
    const source = target("claude-code", "skill", "user", "release-check")
    const destination = target("codex", "skill", "user", "release-check")
    const sourceFile = join(home, ".claude", "skills", "release-check", "SKILL.md")
    const targetFile = join(home, ".agents", "skills", "release-check", "SKILL.md")
    write(
      sourceFile,
      [
        "---",
        "name: release-check",
        "description: Release check",
        "metadata:",
        "  path: /Users/private",
        "  cwd: /repo",
        "  hash: secret-file-hash",
        "  backup: /tmp/backup",
        "  runtime: next-run",
        "---",
        "",
        "body",
        "",
      ].join("\n"),
    )

    const preview = await previewCrossHarnessCopy(
      { source, target: destination, collisionPolicy: "reject" },
      { homeDir: home },
    )

    expect(preview).toMatchObject({
      status: "unsupported",
      canApply: false,
      portableManifest: null,
      confirmationHash: null,
    })
    expect(preview.reasons.join(" ")).toContain("metadata.metadata.path is host-only")
    expect(existsSync(targetFile)).toBe(false)
  })

  it("reports unsupported target capability without inventing parity", async () => {
    const home = temporaryRoot()
    const source = target("claude-code", "skill", "user", "release-check")
    const destination = target("opencode", "skill", "user", "release-check")
    write(join(home, ".claude", "skills", "release-check", "SKILL.md"), validSkill("release-check"))

    const preview = await previewCrossHarnessCopy(
      { source, target: destination, collisionPolicy: "reject" },
      { homeDir: home },
    )

    expect(preview).toMatchObject({
      status: "unsupported",
      canApply: false,
      sourceCapability: { inventory: "supported", mutations: ["create", "update", "delete"] },
      targetCapability: { inventory: "supported", mutations: [] },
      targetPath: null,
    })
    expect(preview.reasons).toEqual(
      expect.arrayContaining([
        "The target capability cannot create native extensions",
        "No native target adapter is registered",
      ]),
    )
  })

  it("rejects stale source previews without touching the target", async () => {
    const home = temporaryRoot()
    const source = target("claude-code", "skill", "user", "release-check")
    const destination = target("codex", "skill", "user", "release-check")
    const sourceFile = join(home, ".claude", "skills", "release-check", "SKILL.md")
    const targetFile = join(home, ".agents", "skills", "release-check", "SKILL.md")
    write(sourceFile, validSkill("release-check"))
    const preview = await previewCrossHarnessCopy(
      { source, target: destination, collisionPolicy: "reject" },
      { homeDir: home },
    )
    writeFileSync(sourceFile, validSkill("release-check").replace("body", "changed"))

    await expect(
      applyCrossHarnessCopy(confirmed(preview, source, destination), { homeDir: home }),
    ).rejects.toThrow("Source extension changed after copy preview")
    expect(existsSync(targetFile)).toBe(false)
  })

  it("rolls target writes back when post-commit verification fails", async () => {
    const home = temporaryRoot()
    const source = target("claude-code", "command", "user", "review")
    const destination = target("codex", "command", "user", "review")
    const sourceFile = join(home, ".claude", "commands", "review.md")
    const targetFile = join(home, ".codex", "commands", "review.md")
    const sourceRaw = "---\ndescription: New review\n---\n\nnew body\n"
    const targetRaw = "---\ndescription: Old review\n---\n\nold body\n"
    write(sourceFile, sourceRaw)
    write(targetFile, targetRaw)
    const preview = await previewCrossHarnessCopy(
      { source, target: destination, collisionPolicy: "overwrite" },
      { homeDir: home },
    )

    await expect(
      applyCrossHarnessCopy(confirmed(preview, source, destination), {
        homeDir: home,
        afterCommit: () => {
          throw new Error("simulated copy verification failure")
        },
      }),
    ).rejects.toThrow("simulated copy verification failure")
    expect(readFileSync(sourceFile, "utf8")).toBe(sourceRaw)
    expect(readFileSync(targetFile, "utf8")).toBe(targetRaw)
  })

  it("rejects target symlink escapes before preview and leaves source untouched", async () => {
    const home = temporaryRoot()
    const outside = temporaryRoot()
    const source = target("claude-code", "skill", "user", "release-check")
    const destination = target("codex", "skill", "user", "release-check")
    const sourceFile = join(home, ".claude", "skills", "release-check", "SKILL.md")
    const outsideFile = join(outside, "SKILL.md")
    write(sourceFile, validSkill("release-check"))
    write(outsideFile, validSkill("outside"))
    mkdirSync(join(home, ".agents", "skills"), { recursive: true })
    symlinkSync(outside, join(home, ".agents", "skills", "release-check"))

    await expect(
      previewCrossHarnessCopy(
        { source, target: destination, collisionPolicy: "overwrite" },
        { homeDir: home },
      ),
    ).rejects.toThrow(/symbolic link|real directory/)
    expect(readFileSync(sourceFile, "utf8")).toBe(validSkill("release-check"))
    expect(readFileSync(outsideFile, "utf8")).toBe(validSkill("outside"))
  })
})

describe("portable extension manifest sanitization", () => {
  it("rejects host-only fields and unsafe nested records", () => {
    const base = {
      schemaVersion: 1 as const,
      origin: { harness: "codex" as const, kind: "skill" as const, scope: "user" as const },
      kind: "skill" as const,
      name: "safe-skill",
      content: "body",
      metadata: { name: "safe-skill", description: "safe" },
    }
    expect(() => sanitizePortableExtensionManifest({ ...base, path: "/Users/private" })).toThrow()

    const poisoned = JSON.parse(
      '{"name":"safe-skill","description":"safe","nested":{"__proto__":{"polluted":true}}}',
    )
    expect(() => sanitizePortableExtensionManifest({ ...base, metadata: poisoned })).toThrow(
      "not portable",
    )
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined()
    expect(() =>
      sanitizePortableExtensionManifest({
        ...base,
        metadata: { ...base.metadata, score: Number.POSITIVE_INFINITY },
      }),
    ).toThrow("JSON-compatible")
  })

  it.each([
    ["path", "/Users/private"],
    ["cwd", "/repo"],
    ["hash", "secret-file-hash"],
    ["backup", { id: "backup-id" }],
    ["runtime", { state: "next-run" }],
  ])("rejects nested host-only %s metadata", (key, value) => {
    const manifest = portableManifest({ metadata: { [key]: value } })

    expect(() => sanitizePortableExtensionManifest(manifest)).toThrow(
      `metadata.metadata.${key} is host-only`,
    )
  })

  it("retains allowed portable metadata without substring false positives", () => {
    const allowed = {
      category: "review",
      pathHint: "docs only",
      runtimeNotes: "Node-compatible",
      hashingAlgorithm: "sha256",
      backupStrategy: "manual",
      nested: { labels: ["safe", "portable"], enabled: true, retries: 2 },
    }
    const sanitized = sanitizePortableExtensionManifest(portableManifest({ metadata: allowed }))

    expect(sanitized.metadata.metadata).toEqual(allowed)
  })
})

function portableManifest(metadata: Record<string, unknown>) {
  return {
    schemaVersion: 1 as const,
    origin: { harness: "codex" as const, kind: "skill" as const, scope: "user" as const },
    kind: "skill" as const,
    name: "safe-skill",
    content: "body",
    metadata: { name: "safe-skill", description: "safe", ...metadata },
  }
}

function confirmed(
  preview: CrossHarnessCopyPreview,
  source: NativeExtensionTarget,
  targetValue: NativeExtensionTarget,
): CrossHarnessCopyApplyInput {
  return {
    source,
    target: targetValue,
    collisionPolicy: preview.collision.policy,
    expectedSourceHash: preview.sourceHash!,
    expectedTargetHash: preview.targetBeforeHash,
    confirmationHash: preview.confirmationHash!,
  }
}

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
  const root = mkdtempSync(join(tmpdir(), "flapstack-cross-harness-copy-"))
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
