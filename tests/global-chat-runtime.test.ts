import { mkdtemp, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, relative } from "node:path"
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
})
