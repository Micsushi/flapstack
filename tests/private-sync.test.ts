import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { simpleGit } from "simple-git"
import { describe, expect, it } from "vitest"
import {
  commitPrivateSync,
  linkPrivateSync,
  previewPrivateSync,
  pullPrivateSync,
  pushPrivateSync,
  unlinkPrivateSync,
} from "../src/main/lib/portability/private-sync"
import { tempRoot } from "./portability-test-helpers"

describe("private-sync", { timeout: process.platform === "win32" ? 60_000 : 20_000 }, () => {
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
