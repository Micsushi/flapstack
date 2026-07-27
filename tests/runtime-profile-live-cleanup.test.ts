import { describe, expect, it, vi } from "vitest"
import { cleanupRuntimeProfileProof } from "../scripts/lib/runtime-profile-cleanup.mjs"

describe("Runtime/Profile live proof cleanup", () => {
  it("captures standalone ownership, continues after a failed stop, and is idempotent", async () => {
    let stopAttempts = 0
    const call = vi.fn(async (name: string, input: any) => {
      if (name === "mutate_stage4_profile" && input.action === "standalone-stop") {
        stopAttempts += 1
        if (stopAttempts === 1) throw new Error("transient stop failure")
        return { stopped: true }
      }
      if (name === "mutate_stage4_runtime" && input.action === "undo-continuation") {
        return { undone: true }
      }
      return { ok: true }
    })
    const state = {
      activitySeeded: true,
      chat: {
        chatId: "fixture-chat",
        subChatId: "fixture-sub",
        stage4FixtureHandle: "fixture-handle",
      },
      testProject: {
        created: true,
        restored: false,
        project: { id: "project-1" },
      },
      importedProfile: { profileHandle: "imported-profile-handle" },
      standaloneProfile: { profileHandle: "standalone-profile-handle" },
      standaloneLaunch: {
        id: "standalone-launch",
        launchHandle: "standalone-launch-handle",
        chatId: "standalone-chat",
        runId: "standalone-run",
      },
      standaloneLaunches: [
        {
          id: "standalone-launch",
          launchHandle: "standalone-launch-handle",
          chatId: "standalone-chat",
          runId: "standalone-run",
        },
        {
          id: "continued-launch",
          launchHandle: "continued-launch-handle",
          chatId: "continued-chat",
          runId: "continued-run",
        },
      ],
      continuation: {
        chatId: "continuation-chat",
        continuationHandle: "continuation-handle",
      },
      continuationUndone: false,
      originalDefault: null,
      writtenDefault: { version: 1 },
    }

    const first = await cleanupRuntimeProfileProof(call, state)
    expect(first.errors).toEqual([
      expect.objectContaining({ operation: "stop-standalone", message: "transient stop failure" }),
    ])
    expect(call).toHaveBeenCalledWith("archive_test_chat", { chatId: "standalone-chat" })
    expect(call).toHaveBeenCalledWith("archive_test_chat", { chatId: "continued-chat" })
    expect(call).toHaveBeenCalledWith("archive_test_chat", { chatId: "fixture-chat" })

    const second = await cleanupRuntimeProfileProof(call, state)
    expect(second.errors).toEqual([])
    expect(stopAttempts).toBe(2)
    expect(
      call.mock.calls.filter(
        ([name, input]) => name === "mutate_stage4_profile" && input.action === "standalone-stop",
      ),
    ).toHaveLength(2)
  })

  it("archives the continuation if undo fails and reports every cleanup error", async () => {
    const call = vi.fn(async (name: string, input: any) => {
      if (name === "mutate_stage4_runtime" && input.action === "undo-continuation") {
        throw new Error("undo failed")
      }
      if (name === "archive_test_chat" && input.chatId === "continuation-chat") {
        throw new Error("archive failed")
      }
      return { ok: true }
    })
    const result = await cleanupRuntimeProfileProof(call, {
      chat: {
        chatId: "fixture-chat",
        stage4FixtureHandle: "fixture-handle",
      },
      continuation: {
        chatId: "continuation-chat",
        continuationHandle: "continuation-handle",
      },
      continuationUndone: false,
    })

    expect(result.errors).toEqual([
      expect.objectContaining({ operation: "undo-continuation", message: "undo failed" }),
      expect.objectContaining({
        operation: "archive-continuation-chat",
        message: "archive failed",
      }),
    ])
  })

  it("treats a false undo result as a cleanup failure and uses fallback archival", async () => {
    const call = vi.fn(async () => ({ undone: false }))
    const result = await cleanupRuntimeProfileProof(call, {
      chat: {
        chatId: "fixture-chat",
        stage4FixtureHandle: "fixture-handle",
      },
      continuation: {
        chatId: "continuation-chat",
        continuationHandle: "continuation-handle",
      },
      continuationUndone: false,
    })

    expect(result.errors).toEqual([
      expect.objectContaining({
        operation: "undo-continuation",
        message: "cleanup operation did not confirm success",
      }),
    ])
    expect(call).toHaveBeenCalledWith("archive_test_chat", {
      chatId: "continuation-chat",
    })
  })
})
