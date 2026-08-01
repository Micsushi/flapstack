import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { AgentPersonalityRootWatcher } from "../src/main/lib/agent-profiles/personality-watcher"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("Agent Personality filesystem watcher", () => {
  it("invalidates external durable edits and closes without retaining watchers", async () => {
    const root = await mkdtemp(join(tmpdir(), "flapstack-personality-watch-"))
    roots.push(root)
    const personality = join(root, "11111111-1111-4111-8111-111111111111")
    await mkdir(personality)
    const notify = vi.fn()
    const watcher = new AgentPersonalityRootWatcher(notify, 5)
    await watcher.observe(root)
    await watcher.observe(root)
    await writeFile(join(personality, "v1.md"), "# External edit\n")

    await vi.waitFor(() => expect(notify).toHaveBeenCalledOnce(), { timeout: 2_000 })
    await watcher.close()
    await writeFile(join(personality, "v2.md"), "# After close\n")
    await new Promise((resolve) => setTimeout(resolve, 150))
    expect(notify).toHaveBeenCalledOnce()
  })
})
