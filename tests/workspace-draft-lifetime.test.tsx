// @vitest-environment jsdom
import React, { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, expect, it, vi } from "vitest"

const backend = vi.hoisted(() => {
  const rows = new Map<string, { id: string; content: string; revision: number }>()
  const state = {
    fail: false,
    gate: null as Promise<void> | null,
    opening: null as Promise<void> | null,
  }
  const open = vi.fn(async (input: { projectId: string; chatId: string; relativePath: string }) => {
    await state.opening
    const id = JSON.stringify(input)
    const row = rows.get(id) ?? { id, content: "original", revision: 0 }
    rows.set(id, row)
    return {
      draft: { ...row, ...input, baseSha256: "a".repeat(64), pendingSave: null },
      leaseToken: "lease",
      conflict: false,
      diskSha256: "a".repeat(64),
      autosaveAllowed: true,
    }
  })
  const update = vi.fn(
    async (input: { draftId: string; content: string; expectedRevision: number }) => {
      await state.gate
      if (state.fail) throw new Error("Storage unavailable")
      const row = rows.get(input.draftId)!
      if (row.revision !== input.expectedRevision) throw new Error("Stale revision")
      const next = { ...row, content: input.content, revision: row.revision + 1 }
      rows.set(row.id, next)
      return { ...next, baseSha256: "a".repeat(64), pendingSave: null }
    },
  )
  const save = vi.fn(async (input: { id: string; draftId: string }) => {
    const row = rows.get(input.draftId)!
    const next = { ...row, revision: row.revision + 1 }
    rows.set(row.id, next)
    return {
      ok: true,
      draft: { ...next, baseSha256: "b".repeat(64), pendingSave: null },
      operation: {
        id: input.id,
        state: "applied",
        relativePath: "file.txt",
        afterSha256: "b".repeat(64),
      },
    }
  })
  return {
    rows,
    state,
    open,
    update,
    release: vi.fn(async () => ({ released: true })),
    save,
    revert: vi.fn(async (input: { id: string }) => ({ ok: true, operation: { id: input.id } })),
  }
})
vi.mock("../src/renderer/lib/trpc", () => ({
  trpcClient: {
    workspaceEditing: {
      openDraft: { mutate: backend.open },
      updateDraft: { mutate: backend.update },
      saveDraft: { mutate: backend.save },
      revert: { mutate: backend.revert },
      releaseDraft: { mutate: backend.release },
      read: { query: async () => ({ content: "original", sha256: "a".repeat(64), byteLength: 8 }) },
    },
  },
}))
import {
  acquireWorkspaceDraft,
  useWorkspaceDraft,
} from "../src/renderer/features/file-viewer/hooks/use-workspace-draft"
import {
  clearAppActionHistory,
  undoAppAction,
  redoAppAction,
} from "../src/renderer/lib/app-action-history"

globalThis.IS_REACT_ACT_ENVIRONMENT = true
type Target = Parameters<typeof acquireWorkspaceDraft>[0]
const targets: Target[] = []
const handles: ReturnType<typeof acquireWorkspaceDraft>[] = []
let reactRoot: Root | undefined, container: HTMLDivElement | undefined
function target(): Target {
  const next = {
    projectId: crypto.randomUUID(),
    chatId: "chat",
    rootPath: "/root",
    relativePath: "file.txt",
  }
  targets.push(next)
  return next
}
function acquire(value: Target) {
  const handle = acquireWorkspaceDraft(value)
  handles.push(handle)
  return handle
}
afterEach(async () => {
  if (reactRoot) await act(async () => reactRoot!.unmount())
  container?.remove()
  reactRoot = undefined
  backend.state.fail = false
  backend.state.gate = null
  backend.state.opening = null
  for (const handle of handles.splice(0)) handle.release()
  for (const value of targets.splice(0)) {
    const handle = acquireWorkspaceDraft(value)
    await handle.session.open()
    await handle.session.retry()
    handle.release()
    await vi.waitFor(() => expect(handle.session.getSnapshot().phase).toBe("closed"))
  }
  backend.rows.clear()
  clearAppActionHistory()
  vi.clearAllMocks()
})

it("shares ownership through a pane move and releases only the last view", async () => {
  const value = target(),
    first = acquire(value),
    second = acquire(value)
  expect(first.session).toBe(second.session)
  await first.session.open()
  first.release()
  expect(backend.release).not.toHaveBeenCalled()
  second.session.setContent("moving draft")
  second.release()
  const moved = acquire(value)
  expect(moved.session).toBe(first.session)
  await moved.session.flush()
  expect(moved.session.getSnapshot().content).toBe("moving draft")
  expect(backend.open).toHaveBeenCalledOnce()
  expect(backend.release).not.toHaveBeenCalled()
})

it("shares the opt-in across panes and reverses the setting without writing a file", async () => {
  let binding!: ReturnType<typeof useWorkspaceDraft>
  const value = target()
  function Fixture() {
    binding = useWorkspaceDraft(value)
    return <span>{String(binding.state.autosave)}</span>
  }
  container = document.createElement("div")
  document.body.append(container)
  reactRoot = createRoot(container)
  await act(async () => reactRoot!.render(<Fixture />))
  await act(async () => {
    expect(binding.setAutosave(true)).toBe(true)
  })
  const other = acquire(value)
  expect(other.session.getSnapshot().autosave).toBe(true)
  await act(async () => {
    expect(await undoAppAction()).toBe(true)
  })
  expect(other.session.getSnapshot().autosave).toBe(false)
  await act(async () => {
    expect(await redoAppAction()).toBe(true)
  })
  expect(other.session.getSnapshot().autosave).toBe(true)
  expect(backend.save).not.toHaveBeenCalled()
})

it("protects unacknowledged text from unload and stops blocking after persistence", async () => {
  const handle = acquire(target())
  await handle.session.open()
  let release!: () => void
  backend.state.gate = new Promise<void>((resolve) => {
    release = resolve
  })
  handle.session.setContent("pending")
  const unloading = new Event("beforeunload", { cancelable: true })
  window.dispatchEvent(unloading)
  expect(unloading.defaultPrevented).toBe(true)
  release()
  await handle.session.flush()
  const safe = new Event("beforeunload", { cancelable: true })
  window.dispatchEvent(safe)
  expect(safe.defaultPrevented).toBe(false)
  expect(backend.save).not.toHaveBeenCalled()
})

it("retains an unmounted failed buffer for retry instead of discarding it", async () => {
  const value = target(),
    first = acquire(value)
  await first.session.open()
  backend.state.fail = true
  first.session.setContent("recover me")
  await first.session.flush()
  first.release()
  const reopened = acquire(value)
  expect(reopened.session).toBe(first.session)
  expect(reopened.session.getSnapshot().content).toBe("recover me")
  backend.state.fail = false
  expect(await reopened.session.retry()).toBe(true)
  expect(reopened.session.hasUnpersistedText()).toBe(false)
})

it("does not show another file's buffer while a new hook target is opening", async () => {
  function Fixture({ value }: { value: Target }) {
    const { state } = useWorkspaceDraft(value)
    return <pre>{state.content}</pre>
  }
  container = document.createElement("div")
  document.body.append(container)
  reactRoot = createRoot(container)
  const first = target(),
    second = target()
  await act(async () => reactRoot!.render(<Fixture value={first} />))
  expect(container.textContent).toBe("original")
  let release!: () => void
  backend.state.opening = new Promise<void>((resolve) => {
    release = resolve
  })
  await act(async () => reactRoot!.render(<Fixture value={second} />))
  expect(container.textContent).toBe("")
  await act(async () => {
    release()
  })
  expect(container.textContent).toBe("original")
})

it("records reversible saves and retries the same inverse UUID after a lost acknowledgement", async () => {
  const handle = acquire(target())
  await handle.session.open()
  handle.session.setContent("saved text")
  expect(await handle.session.save()).toBe(true)
  backend.revert.mockRejectedValueOnce(new Error("Acknowledgement lost"))
  await expect(undoAppAction()).rejects.toThrow("Acknowledgement lost")
  expect(await undoAppAction()).toBe(true)
  const first = backend.revert.mock.calls[0]![0]
  expect(backend.revert.mock.calls[1]![0]).toEqual(first)
  expect(await redoAppAction()).toBe(true)
  expect(backend.revert.mock.calls[2]![0]).toMatchObject({ operationId: first.id })
  expect(handle.session.getSnapshot().content).toBe("saved text")
  expect(handle.session.getSnapshot().conflict).toBe(true)
})
