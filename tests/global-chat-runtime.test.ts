import { mkdtemp, readFile, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, relative } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import {
  ensureGlobalChatRuntimePath,
  getGlobalChatRuntimePath,
} from "../src/main/lib/global-chat-runtime"

describe("global Chat runtime directory", () => {
  it("creates an isolated non-checkout directory without allowing path traversal", async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), "flapstack-global-chat-"))
    try {
      const runtimePath = await ensureGlobalChatRuntimePath(userDataPath, "../../outside")

      expect(runtimePath).toBe(getGlobalChatRuntimePath(userDataPath, "../../outside"))
      expect(relative(userDataPath, runtimePath)).toBe(
        join("data", "global-chats", "%2E%2E%2F%2E%2E%2Foutside"),
      )
      expect(relative(userDataPath, getGlobalChatRuntimePath(userDataPath, ".."))).toBe(
        join("data", "global-chats", "%2E%2E"),
      )
      expect((await stat(runtimePath)).isDirectory()).toBe(true)
    } finally {
      await rm(userDataPath, { recursive: true, force: true })
    }
  })

  it("wires the isolated directory into global Chat creation and runtime transport", async () => {
    const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..")
    const [routerSource, chatSource] = await Promise.all([
      readFile(join(repoRoot, "src/main/lib/trpc/routers/chats.ts"), "utf8"),
      readFile(join(repoRoot, "src/renderer/features/agents/main/active-chat.tsx"), "utf8"),
    ])

    expect(
      routerSource.match(/ensureGlobalChatRuntimePath\(app\.getPath\("userData"\), chat\.id\)/g),
    ).toHaveLength(2)
    expect(chatSource).toContain(
      "activeTargetWorktreePath || worktreePath || globalRuntimePath || sandboxUrl",
    )
    expect(chatSource).toContain("targetWorktreePath || worktreePath || globalRuntimePath")
  })
})
