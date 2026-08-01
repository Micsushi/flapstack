import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { mkdtemp, mkdir, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  AgentPersonalityStore,
  AgentPersonalityStoreError,
} from "../src/main/lib/agent-profiles/personality-store"
import {
  parseAgentPersonalityMarkdown,
  serializeAgentPersonalityMarkdown,
} from "../src/main/lib/agent-profiles/personality-markdown"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("Stage 6 Agent Personality storage", () => {
  it("appends immutable versions with optimistic conflicts and exact historical reads", async () => {
    const store = await createStore()
    const created = store.create(input("Direct"))
    expect(store.list()[0]?.provenance).toEqual({
      kind: "local",
      sourceLabel: null,
      trusted: true,
    })
    const updated = store.update({
      personalityId: created.metadata.id,
      expectedVersion: 1,
      traits: { ...created.metadata.traits, verbosity: "detailed" },
      body: "Lead with the outcome and show evidence.",
    })

    expect(updated.metadata.version).toBe(2)
    expect(store.get({ personalityId: created.metadata.id, version: 1 }).body).toBe(
      "Lead with the outcome.",
    )
    expect(store.get({ personalityId: created.metadata.id, version: 2 }).body).toContain(
      "show evidence",
    )
    expect(() =>
      store.update({
        personalityId: created.metadata.id,
        expectedVersion: 1,
        traits: created.metadata.traits,
        body: "stale",
      }),
    ).toThrowError(AgentPersonalityStoreError)
  })

  it("supports exact shared references without sharing profile capability", async () => {
    const store = await createStore()
    const direct = store.create(input("Direct"))
    const ref = { personalityId: direct.metadata.id, version: direct.metadata.version }

    expect(store.resolve(ref).digest).toBe(direct.digest)
    expect(store.resolve(ref).metadata).not.toHaveProperty("tools")
    expect(store.resolve(ref).metadata).not.toHaveProperty("permissions")

    store.archive({ personalityId: direct.metadata.id, expectedVersion: 1 })
    expect(() => store.resolve(ref)).toThrow(/archived/i)
    expect(store.get(ref).digest).toBe(direct.digest)
    store.restore({ personalityId: direct.metadata.id, expectedVersion: 1 })
    expect(store.resolve(ref).digest).toBe(direct.digest)
  })

  it("resolves exact visible base chains and fails closed for archived, missing, or cyclic bases", async () => {
    const store = await createStore()
    const base = store.create({
      ...input("Base"),
      traits: { ...input("Base").traits, labels: ["base"], tone: "warm" },
      body: "Base guidance.",
    })
    const child = store.create({
      ...input("Child"),
      base: { personalityId: base.metadata.id, version: 1 },
      traits: { ...input("Child").traits, labels: ["child"], tone: "direct" },
      body: "Child guidance.",
    })
    const childRef = { personalityId: child.metadata.id, version: 1 }
    const resolved = store.resolveCombinedVisible(childRef, {
      type: "user",
      projectId: null,
    })
    expect(resolved.body).toBe("Base guidance.\n\nChild guidance.")
    expect(resolved.metadata.traits).toMatchObject({
      tone: "direct",
      labels: ["base", "child"],
    })
    expect(resolved.chain.map((item) => item.ref)).toEqual([
      { personalityId: base.metadata.id, version: 1 },
      childRef,
    ])

    store.archive({ personalityId: base.metadata.id, expectedVersion: 1 })
    expect(() => store.resolveCombinedVisible(childRef, { type: "user", projectId: null })).toThrow(
      /archived/i,
    )
    store.restore({ personalityId: base.metadata.id, expectedVersion: 1 })
    rmSync(join(store.rootFor({ type: "user", projectId: null }), base.metadata.id), {
      recursive: true,
    })
    expect(() => store.resolveCombinedVisible(childRef, { type: "user", projectId: null })).toThrow(
      /missing/i,
    )

    const cyclic = store.create(input("Cyclic"))
    const source = parseAgentPersonalityMarkdown(readFileSync(cyclic.path, "utf8"))
    const cyclicSource = serializeAgentPersonalityMarkdown({
      metadata: {
        ...source.metadata,
        base: { personalityId: source.metadata.id, version: 1 },
      },
      body: source.body,
    })
    writeFileSync(cyclic.path, cyclicSource, "utf8")
    const reparsed = parseAgentPersonalityMarkdown(cyclicSource)
    const manifestPath = join(
      store.rootFor({ type: "user", projectId: null }),
      cyclic.metadata.id,
      "manifest.json",
    )
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      versionDigests: Record<string, string>
    }
    manifest.versionDigests["1"] = reparsed.digest
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8")
    expect(() =>
      store.resolveCombinedVisible(
        { personalityId: cyclic.metadata.id, version: 1 },
        { type: "user", projectId: null },
      ),
    ).toThrow(/cycle/i)
  })

  it("rejects secrets before writing and quarantines corrupted immutable files", async () => {
    const store = await createStore()
    expect(() =>
      store.create({
        ...input("Unsafe"),
        body: "API_KEY=sk-abcdefghijklmnopqrstuvwxyz123456",
      }),
    ).toThrow(/secret/i)
    expect(store.list()).toEqual([])

    const created = store.create(input("Direct"))
    writeFileSync(created.path, `${readFileSync(created.path, "utf8")}\ncorrupt`, "utf8")
    expect(() => store.get({ personalityId: created.metadata.id, version: 1 })).toThrow(
      /quarantined|digest/i,
    )
    expect(existsSync(created.path)).toBe(false)
    expect(existsSync(join(store.rootFor({ type: "user", projectId: null }), ".quarantine"))).toBe(
      true,
    )
  })

  it("rejects symlinked durable version targets when the platform permits the fixture", async () => {
    const store = await createStore()
    const created = store.create(input("Direct"))
    const outside = join(store.rootFor({ type: "user", projectId: null }), "..", "outside.md")
    writeFileSync(outside, readFileSync(created.path, "utf8"), "utf8")
    rmSync(created.path)
    try {
      await symlink(outside, created.path, "file")
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") return
      throw error
    }
    expect(() => store.get({ personalityId: created.metadata.id, version: 1 })).toThrow(/symlink/i)
  })

  it("rejects a symlinked personality storage root", async () => {
    const root = await mkdtemp(join(tmpdir(), "flapstack-personality-root-link-"))
    roots.push(root)
    const outside = join(root, "outside")
    const userRoot = join(root, "user")
    await mkdir(outside)
    try {
      await symlink(outside, userRoot, process.platform === "win32" ? "junction" : "dir")
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EPERM") return
      throw error
    }
    const store = new AgentPersonalityStore({
      userRoot,
      projectRoot: () => join(root, "project"),
    })

    expect(() => store.rootFor({ type: "user", projectId: null })).toThrow(/symlink|unsafe/i)
    expect(() => store.create(input("Redirected"))).toThrow(/symlink|unsafe/i)
    expect(existsSync(join(outside, "manifest.json"))).toBe(false)
  })
})

async function createStore() {
  const root = await mkdtemp(join(tmpdir(), "flapstack-personalities-"))
  roots.push(root)
  const userRoot = join(root, "user")
  const projectRoot = join(root, "project")
  await Promise.all([mkdir(userRoot), mkdir(projectRoot)])
  return new AgentPersonalityStore({
    userRoot,
    projectRoot: (projectId) => {
      if (projectId !== "project-1") throw new Error("Unknown project.")
      return projectRoot
    },
  })
}

function input(name: string) {
  return {
    name,
    scope: { type: "user" as const, projectId: null },
    base: null,
    traits: {
      tone: "direct" as const,
      verbosity: "terse" as const,
      formatting: "markdown" as const,
      responseStructure: "Outcome, evidence, blockers.",
      labels: ["precise"],
      color: "#4f46e5",
    },
    body: "Lead with the outcome.",
  }
}
