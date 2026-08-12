import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  clearAppActionHistory,
  getAppActionHistorySnapshot,
  recordAppAction,
  redoAppAction,
  undoAppAction,
} from "../src/renderer/lib/app-action-history"

describe("app action history", () => {
  beforeEach(clearAppActionHistory)

  it("undoes and redoes the latest successful action", async () => {
    const undo = vi.fn()
    const redo = vi.fn()
    recordAppAction({ label: "Move Chat", undo, redo })

    expect(getAppActionHistorySnapshot()).toMatchObject({
      canUndo: true,
      canRedo: false,
      undoLabel: "Move Chat",
    })
    await undoAppAction()
    await redoAppAction()

    expect(undo).toHaveBeenCalledOnce()
    expect(redo).toHaveBeenCalledOnce()
  })

  it("clears redo after a new forward action", async () => {
    recordAppAction({ label: "First", undo: vi.fn(), redo: vi.fn() })
    await undoAppAction()
    recordAppAction({ label: "Second", undo: vi.fn(), redo: vi.fn() })

    expect(getAppActionHistorySnapshot()).toMatchObject({ canUndo: true, canRedo: false })
  })

  it("keeps an entry available when undo fails", async () => {
    recordAppAction({
      label: "Archive Chat",
      undo: () => Promise.reject(new Error("offline")),
      redo: vi.fn(),
    })

    await expect(undoAppAction()).rejects.toThrow("offline")
    expect(getAppActionHistorySnapshot()).toMatchObject({ canUndo: true, canRedo: false })
  })

  it("serializes a new action recorded while undo is running", async () => {
    let finishUndo = () => {}
    const pendingUndo = new Promise<void>((resolve) => {
      finishUndo = resolve
    })
    recordAppAction({ label: "First", undo: () => pendingUndo, redo: vi.fn() })

    const undoing = undoAppAction()
    recordAppAction({ label: "Second", undo: vi.fn(), redo: vi.fn() })
    finishUndo()
    await undoing

    expect(getAppActionHistorySnapshot()).toMatchObject({
      canUndo: true,
      canRedo: false,
      undoLabel: "Second",
    })
  })
})
