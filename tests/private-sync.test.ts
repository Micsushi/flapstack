import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { simpleGit } from "simple-git"
import { describe, expect, it } from "vitest"
import {
  assertPrivateSyncBlobBudget,
  commitPrivateSync,
  getPrivateSyncConfig,
  gitBlobOid,
  linkPrivateSync,
  parsePrivateSyncRemoteOid,
  parsePrivateSyncNameStatus,
  PRIVATE_SYNC_REVIEW_LIMITS,
  previewPrivateSync,
  pullPrivateSync,
  pushPrivateSync,
  unlinkPrivateSync,
} from "../src/main/lib/portability/private-sync"
import { tempRoot } from "./portability-test-helpers"

describe("private-sync", { timeout: 20_000 }, () => {
  it("fails closed when reviewed path or blob budgets are exceeded", () => {
    const output = Array.from(
      { length: PRIVATE_SYNC_REVIEW_LIMITS.changedPathsPerCommit + 1 },
      (_, index) => `M\0scopes/settings/file-${index}.json\0`,
    ).join("")
    expect(() =>
      parsePrivateSyncNameStatus(output, PRIVATE_SYNC_REVIEW_LIMITS.changedPathsPerCommit),
    ).toThrow(/64 commits.*256 changed paths.*2,048 total.*16,000,000 scanned blob bytes/i)
    expect(() =>
      assertPrivateSyncBlobBudget(PRIVATE_SYNC_REVIEW_LIMITS.totalBlobBytes + 1),
    ).toThrow(/split or squash/i)
  })

  it("rejects unknown Git object formats before producing a preview OID", () => {
    expect(() => gitBlobOid(Buffer.from("safe"), "sha512")).toThrow(/unsupported.*format/i)
    expect(() => gitBlobOid(Buffer.from("safe"), "")).toThrow(/unsupported.*format/i)
  })

  it("fails closed on malformed or wrong-format remote advertisements", () => {
    expect(() => parsePrivateSyncRemoteOid("garbage\n", "refs/heads/main", "sha1")).toThrow(
      /advertisement is malformed/i,
    )
    expect(() =>
      parsePrivateSyncRemoteOid(`${"a".repeat(64)}\trefs/heads/main\n`, "refs/heads/main", "sha1"),
    ).toThrow(/does not match repository sha1/i)
  })

  it("stages only approved paths and previews exact outgoing committed objects", async () => {
    const fixture = await createRemoteFixture()
    const stateRoot = await linkFixture(fixture)
    await writeFile(join(fixture.local, "scopes/settings/config.json"), '{"theme":"dark"}\n')
    await mkdir(join(fixture.local, "scopes/extensions"), { recursive: true })
    await writeFile(join(fixture.local, "scopes/extensions/not-approved.md"), "do not stage")
    const commitPreview = await previewPrivateSync(stateRoot, "commit")
    expect(commitPreview.files.map((entry) => entry.path)).toEqual(["scopes/settings/config.json"])
    expect(commitPreview.secretSafe).toBe(true)
    expect(commitPreview.files[0]?.newOid).toBe(
      (
        await simpleGit(fixture.local).raw(["hash-object", "--", "scopes/settings/config.json"])
      ).trim(),
    )
    await expect(
      commitPrivateSync({ stateRoot, expectedFingerprint: "stale", message: "Update settings" }),
    ).rejects.toThrow(/fingerprint|stale|ENOENT/i)
    await commitPrivateSync({
      stateRoot,
      expectedFingerprint: commitPreview.fingerprint,
      message: "Update settings",
    })
    expect((await simpleGit(fixture.local).status()).not_added).toContain(
      "scopes/extensions/not-approved.md",
    )
    const pushPreview = await previewPrivateSync(stateRoot, "push")
    expect(pushPreview.files).toEqual([
      expect.objectContaining({ path: "scopes/settings/config.json", status: "outgoing:M" }),
    ])
    expect(pushPreview.localOid).toMatch(/^[a-f0-9]{40}$/)
    expect(pushPreview.remoteOid).toMatch(/^[a-f0-9]{40}$/)
    await expect(
      pushPrivateSync({ stateRoot, expectedFingerprint: pushPreview.fingerprint }),
    ).resolves.toEqual({ pushed: true })
  })

  it("rejects an unapproved path anywhere in the incoming commit range", async () => {
    const fixture = await createRemoteFixture()
    const stateRoot = await linkFixture(fixture)
    const peer = await clonePeer(fixture)
    await mkdir(join(peer, "outside"))
    await writeFile(join(peer, "outside/unapproved.txt"), "remote")
    await simpleGit(peer).add("outside/unapproved.txt").commit("Unapproved remote").push()
    await expect(previewPrivateSync(stateRoot, "pull")).rejects.toThrow(/unapproved path/i)
  })

  it("rejects incoming history beyond the reviewed commit cap before blob scanning", async () => {
    const fixture = await createRemoteFixture()
    const stateRoot = await linkFixture(fixture)
    const peer = await clonePeer(fixture)
    const git = simpleGit(peer)
    for (let index = 0; index <= PRIVATE_SYNC_REVIEW_LIMITS.commitCount; index += 1) {
      await git.raw(["commit", "--allow-empty", "-m", `Bounded history ${index}`])
    }
    await git.push()
    await expect(previewPrivateSync(stateRoot, "pull")).rejects.toThrow(
      /review exceeds supported history limits.*split or squash/i,
    )
  }, 60_000)

  it("rejects an unapproved path in outgoing committed history", async () => {
    const fixture = await createRemoteFixture()
    const stateRoot = await linkFixture(fixture)
    await writeFile(join(fixture.local, "outside.txt"), "local")
    await simpleGit(fixture.local).add("outside.txt").commit("Unapproved outgoing")
    await expect(previewPrivateSync(stateRoot, "push")).rejects.toThrow(/unapproved path/i)
  })

  it("scans outgoing committed blobs when the worktree is clean", async () => {
    const fixture = await createRemoteFixture()
    const stateRoot = await linkFixture(fixture)
    await writeFile(
      join(fixture.local, "scopes/settings/config.json"),
      "OPENAI_API_KEY=sk-live-secretsecretsecret",
    )
    await simpleGit(fixture.local).add("scopes/settings/config.json").commit("Secret outgoing")
    expect((await simpleGit(fixture.local).status()).isClean()).toBe(true)
    const preview = await previewPrivateSync(stateRoot, "push")
    expect(preview.secretSafe).toBe(false)
    await expect(
      pushPrivateSync({ stateRoot, expectedFingerprint: preview.fingerprint }),
    ).rejects.toThrow(/secret/i)
  })

  it("rejects a worktree file changed between open and exact snapshot completion", async () => {
    const fixture = await createRemoteFixture()
    const stateRoot = await linkFixture(fixture)
    const relativePath = "scopes/settings/config.json"
    const absolutePath = join(fixture.local, relativePath)
    await writeFile(absolutePath, "AWS_SECRET_ACCESS_KEY=plain-secret-without-prefix")
    await expect(
      previewPrivateSync(stateRoot, "commit", {
        afterWorktreeFileOpen: async (path) => {
          if (path === relativePath) await writeFile(absolutePath, "benign")
        },
      }),
    ).rejects.toThrow(/changed while reading/i)
  })

  it("rejects a worktree leaf symlink before hashing or secret scanning", async () => {
    const fixture = await createRemoteFixture()
    const stateRoot = await linkFixture(fixture)
    const configPath = join(fixture.local, "scopes/settings/config.json")
    const outside = join(fixture.root, "outside-secret.txt")
    await writeFile(outside, "AWS_SECRET_ACCESS_KEY=outside-secret")
    await rm(configPath)
    await symlink(outside, configPath)
    await expect(previewPrivateSync(stateRoot, "commit")).rejects.toThrow(/non-symlink/i)
  })

  it.each([
    ["AWS", "AKIAIOSFODNN7EXAMPLE"],
    ["Google", `AIza${"A".repeat(35)}`],
    ["AWS secret assignment", 'export AWS_SECRET_ACCESS_KEY="plain-secret-with-no-prefix"'],
  ])("rejects a bare %s key in an outgoing committed blob", async (_provider, secret) => {
    const fixture = await createRemoteFixture()
    const stateRoot = await linkFixture(fixture)
    await writeFile(join(fixture.local, "scopes/settings/config.json"), secret)
    await simpleGit(fixture.local).add("scopes/settings/config.json").commit("Secret outgoing")
    const preview = await previewPrivateSync(stateRoot, "push")
    expect(preview.secretSafe).toBe(false)
    await expect(
      pushPrivateSync({ stateRoot, expectedFingerprint: preview.fingerprint }),
    ).rejects.toThrow(/secret/i)
  })

  it("CASes the reviewed commit parent and leaves a concurrently moved ref untouched", async () => {
    const fixture = await createRemoteFixture()
    const stateRoot = await linkFixture(fixture)
    const git = simpleGit(fixture.local)
    const reviewedParent = (await git.revparse("HEAD")).trim()
    await writeFile(join(fixture.local, "scopes/settings/config.json"), '{"reviewed":true}\n')
    const preview = await previewPrivateSync(stateRoot, "commit")
    let concurrentOid = ""
    await expect(
      commitPrivateSync({
        stateRoot,
        expectedFingerprint: preview.fingerprint,
        message: "Reviewed update",
        hooks: {
          beforeCommitCas: async () => {
            await writeFile(join(fixture.local, "concurrent.txt"), "other process")
            await git.add("concurrent.txt").commit("Concurrent move")
            concurrentOid = (await git.revparse("HEAD")).trim()
          },
        },
      }),
    ).rejects.toThrow()
    expect((await git.revparse("HEAD")).trim()).toBe(concurrentOid)
    expect((await git.revparse(`${concurrentOid}^`)).trim()).toBe(reviewedParent)
    expect(await git.raw(["log", "-1", "--format=%s", concurrentOid])).toContain("Concurrent move")
  })

  it("pulls the exact reviewed OID when the remote moves after preview", async () => {
    const fixture = await createRemoteFixture()
    const stateRoot = await linkFixture(fixture)
    const peer = await clonePeer(fixture)
    await writeFile(join(peer, "scopes/settings/config.json"), '{"version":1}\n')
    await simpleGit(peer).add("scopes/settings").commit("Remote one").push()
    const preview = await previewPrivateSync(stateRoot, "pull")
    const reviewedOid = preview.remoteOid
    await writeFile(join(peer, "scopes/settings/config.json"), '{"version":2}\n')
    await simpleGit(peer).add("scopes/settings").commit("Remote two").push()
    await expect(
      pullPrivateSync({ stateRoot, expectedFingerprint: preview.fingerprint }),
    ).resolves.toEqual({ updated: true })
    expect((await simpleGit(fixture.local).revparse("HEAD")).trim()).toBe(reviewedOid)
    expect(await readFile(join(fixture.local, "scopes/settings/config.json"), "utf8")).toContain(
      '"version":1',
    )
  })

  it("refuses push when the reviewed remote OID moves", async () => {
    const fixture = await createRemoteFixture()
    const stateRoot = await linkFixture(fixture)
    await writeFile(join(fixture.local, "scopes/settings/config.json"), '{"local":true}\n')
    await simpleGit(fixture.local).add("scopes/settings").commit("Local outgoing")
    const preview = await previewPrivateSync(stateRoot, "push")
    const peer = await clonePeer(fixture)
    await writeFile(join(peer, "scopes/settings/config.json"), '{"remote":true}\n')
    await simpleGit(peer).add("scopes/settings").commit("Remote moved").push()
    await expect(
      pushPrivateSync({ stateRoot, expectedFingerprint: preview.fingerprint }),
    ).rejects.toThrow(/remote moved/i)
  })

  it("atomically rejects a remote move after the final push precheck", async () => {
    const fixture = await createRemoteFixture()
    const stateRoot = await linkFixture(fixture)
    await writeFile(join(fixture.local, "scopes/settings/config.json"), '{"local":true}\n')
    await simpleGit(fixture.local).add("scopes/settings").commit("Local outgoing")
    const preview = await previewPrivateSync(stateRoot, "push")
    const peer = await clonePeer(fixture)
    let concurrentRemoteOid = ""
    await expect(
      pushPrivateSync({
        stateRoot,
        expectedFingerprint: preview.fingerprint,
        hooks: {
          beforePushLease: async () => {
            await writeFile(join(peer, "scopes/settings/config.json"), '{"remote":true}\n')
            await simpleGit(peer).add("scopes/settings").commit("Concurrent remote move").push()
            concurrentRemoteOid = (
              await simpleGit(fixture.remote).revparse("refs/heads/main")
            ).trim()
          },
        },
      }),
    ).rejects.toThrow()
    expect((await simpleGit(fixture.remote).revparse("refs/heads/main")).trim()).toBe(
      concurrentRemoteOid,
    )
  })

  it("atomically rejects remote deletion after the final push precheck", async () => {
    const fixture = await createRemoteFixture()
    const stateRoot = await linkFixture(fixture)
    await writeFile(join(fixture.local, "scopes/settings/config.json"), '{"local":true}\n')
    await simpleGit(fixture.local).add("scopes/settings").commit("Local outgoing")
    const preview = await previewPrivateSync(stateRoot, "push")
    await expect(
      pushPrivateSync({
        stateRoot,
        expectedFingerprint: preview.fingerprint,
        hooks: {
          beforePushLease: async () => {
            await simpleGit(fixture.remote).raw(["update-ref", "-d", "refs/heads/main"])
          },
        },
      }),
    ).rejects.toThrow()
    await expect(
      simpleGit(fixture.remote).raw(["rev-parse", "--verify", "refs/heads/main"]),
    ).rejects.toThrow()
  })

  it("rejects tampered persisted paths and split fetch/push origins", async () => {
    const fixture = await createRemoteFixture()
    const stateRoot = await linkFixture(fixture)
    const configPath = join(stateRoot, "private-sync.json")
    const config = JSON.parse(await readFile(configPath, "utf8")) as { includedPaths: string[] }
    config.includedPaths = ["."]
    await writeFile(configPath, JSON.stringify(config))
    await expect(getPrivateSyncConfig(stateRoot)).rejects.toThrow(/included paths/i)

    await linkFixture(fixture)
    const other = join(fixture.root, "other.git")
    await mkdir(other)
    await simpleGit(other).init(true)
    await simpleGit(fixture.local).raw(["remote", "set-url", "--push", "origin", other])
    await expect(previewPrivateSync(stateRoot, "push")).rejects.toThrow(/fetch or push/i)
  })

  it("rejects detached HEAD and credential-bearing URL variants", async () => {
    const fixture = await createRemoteFixture()
    const stateRoot = await linkFixture(fixture)
    await simpleGit(fixture.local).checkout(
      (await simpleGit(fixture.local).revparse("HEAD")).trim(),
    )
    await expect(previewPrivateSync(stateRoot, "pull")).rejects.toThrow(/detached|attached/i)
    await expect(
      linkPrivateSync({
        stateRoot,
        repoPath: fixture.local,
        remote: "ssh://git:password@example.invalid/private.git",
        branch: "main",
        scopes: ["settings"],
      }),
    ).rejects.toThrow(/credentials/i)
    await expect(
      linkPrivateSync({
        stateRoot,
        repoPath: fixture.local,
        remote: "https://example.invalid/private.git?access_token=secret",
        branch: "main",
        scopes: ["settings"],
      }),
    ).rejects.toThrow(/query|fragment/i)
  })

  it("stops dirty pulls and unlinks without deleting the repository", async () => {
    const fixture = await createRemoteFixture()
    const stateRoot = await linkFixture(fixture)
    const peer = await clonePeer(fixture)
    await writeFile(join(peer, "scopes/settings/config.json"), '{"theme":"remote"}\n')
    await simpleGit(peer).add("scopes/settings").commit("Remote update").push()
    await writeFile(join(fixture.local, "scopes/settings/config.json"), '{"theme":"dirty"}\n')
    const blocked = await previewPrivateSync(stateRoot, "pull")
    await expect(
      pullPrivateSync({ stateRoot, expectedFingerprint: blocked.fingerprint }),
    ).rejects.toThrow(/fast-forward/i)
    await unlinkPrivateSync(stateRoot)
    expect(await readFile(join(fixture.local, "scopes/settings/config.json"), "utf8")).toContain(
      "dirty",
    )
  })

  it("keeps remote preview refs bounded and removes the ref after completion", async () => {
    const fixture = await createRemoteFixture()
    const stateRoot = await linkFixture(fixture)
    await previewPrivateSync(stateRoot, "pull")
    const second = await previewPrivateSync(stateRoot, "pull")
    const git = simpleGit(fixture.local)
    expect(
      (await git.raw(["for-each-ref", "--format=%(refname)", "refs/flapstack/previews"]))
        .trim()
        .split("\n")
        .filter(Boolean),
    ).toEqual(["refs/flapstack/previews/reviewed"])
    await expect(
      pullPrivateSync({ stateRoot, expectedFingerprint: second.fingerprint }),
    ).resolves.toEqual({ updated: false })
    expect(
      (await git.raw(["for-each-ref", "--format=%(refname)", "refs/flapstack/previews"])).trim(),
    ).toBe("")
  })

  it("CAS-creates an unborn SHA-256 branch when the installed Git supports it", async () => {
    const root = await tempRoot()
    const remote = join(root, "sha256.git")
    const local = join(root, "sha256-local")
    try {
      await simpleGit().raw(["init", "--bare", "--object-format=sha256", remote])
      await simpleGit().raw(["init", "--object-format=sha256", "-b", "main", local])
    } catch {
      return
    }
    await configureIdentity(local)
    await simpleGit(local).addRemote("origin", remote)
    const stateRoot = join(root, "state")
    await linkPrivateSync({
      stateRoot,
      repoPath: local,
      remote,
      branch: "main",
      scopes: ["settings"],
    })
    await mkdir(join(local, "scopes/settings"), { recursive: true })
    await writeFile(join(local, "scopes/settings/config.json"), '{"safe":true}\n')
    const preview = await previewPrivateSync(stateRoot, "commit")
    expect(preview.localOid).toBeNull()
    const result = await commitPrivateSync({
      stateRoot,
      expectedFingerprint: preview.fingerprint,
      message: "Initial settings",
    })
    expect(result.commit).toMatch(/^[a-f0-9]{64}$/)
    expect((await simpleGit(local).revparse("HEAD")).trim()).toBe(result.commit)
  })
})

async function linkFixture(
  fixture: Awaited<ReturnType<typeof createRemoteFixture>>,
): Promise<string> {
  const stateRoot = join(fixture.root, "state")
  await linkPrivateSync({
    stateRoot,
    repoPath: fixture.local,
    remote: fixture.remote,
    branch: "main",
    scopes: ["settings"],
  })
  return stateRoot
}

async function clonePeer(
  fixture: Awaited<ReturnType<typeof createRemoteFixture>>,
): Promise<string> {
  const peer = join(fixture.root, `peer-${crypto.randomUUID()}`)
  await simpleGit().clone(fixture.remote, peer, ["--branch", "main"])
  await configureIdentity(peer)
  return peer
}

async function createRemoteFixture(): Promise<{ root: string; remote: string; local: string }> {
  const root = await tempRoot()
  const remote = join(root, "remote.git")
  await mkdir(remote)
  await simpleGit(remote).init(true)
  const seed = join(root, "seed")
  await mkdir(seed)
  const git = simpleGit(seed)
  await git.init()
  await configureIdentity(seed)
  await git.checkoutLocalBranch("main")
  await mkdir(join(seed, "scopes/settings"), { recursive: true })
  await writeFile(join(seed, "scopes/settings/config.json"), '{"theme":"light"}\n')
  await git.add(["scopes/settings"]).commit("Seed")
  await git.addRemote("origin", remote)
  await git.push(["-u", "origin", "main"])
  const local = join(root, "local")
  await simpleGit().clone(remote, local, ["--branch", "main"])
  await configureIdentity(local)
  return { root, remote, local }
}

async function configureIdentity(path: string): Promise<void> {
  const git = simpleGit(path)
  await git.addConfig("user.name", "Portability Test")
  await git.addConfig("user.email", "portability@example.invalid")
}
