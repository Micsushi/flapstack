import { describe, expect, it, vi } from "vitest"

import {
  applyVaultEditorExternalSnapshot,
  createVaultEditorState,
  createVaultConflictCopyPath,
  hasVaultEditorChanges,
  markVaultEditorConflict,
  protectUnsavedVaultDraftsBeforeUnload,
  rebaseVaultEditorAfterSave,
  updateVaultEditorDraft,
  type VaultDocumentSnapshot,
} from "../src/renderer/features/project-vault/editor-state"

const base: VaultDocumentSnapshot = {
  version: 1,
  content: "base",
  contentHash: "a".repeat(64),
  currentContentHash: "a".repeat(64),
  externallyModified: false,
}

describe("project vault editor state", () => {
  it("keeps a conflict copy beside its source note", () => {
    expect(createVaultConflictCopyPath("Decision.md")).toBe("Decision (local copy).md")
    expect(createVaultConflictCopyPath("Research/Decision.md")).toBe(
      "Research/Decision (local copy).md",
    )
  })

  it("keeps the local draft and current version together on conflict", () => {
    const edited = updateVaultEditorDraft(createVaultEditorState(base), "my draft")
    const current: VaultDocumentSnapshot = {
      ...base,
      version: 2,
      content: "agent update",
      contentHash: "b".repeat(64),
      currentContentHash: "b".repeat(64),
    }
    const conflicted = markVaultEditorConflict(edited, current)

    expect(conflicted.draft).toBe("my draft")
    expect(conflicted.base).toEqual(base)
    expect(conflicted.conflict).toEqual(current)
    expect(hasVaultEditorChanges(conflicted)).toBe(true)
  })

  it("reports clean state until the draft differs from its loaded base", () => {
    const clean = createVaultEditorState(base)
    expect(hasVaultEditorChanges(clean)).toBe(false)
    expect(hasVaultEditorChanges(updateVaultEditorDraft(clean, "changed"))).toBe(true)
  })

  it("updates a clean receiver to the newest cross-window snapshot", () => {
    const current = {
      ...base,
      version: 2,
      content: "main window saved",
      contentHash: "b".repeat(64),
      currentContentHash: "b".repeat(64),
    }

    const refreshed = applyVaultEditorExternalSnapshot(createVaultEditorState(base), current)

    expect(refreshed.base).toEqual(current)
    expect(refreshed.draft).toBe("main window saved")
    expect(refreshed.conflict).toBeNull()
  })

  it("preserves a dirty receiver draft and exposes the external version as a conflict", () => {
    const dirty = updateVaultEditorDraft(createVaultEditorState(base), "window two draft")
    const current = {
      ...base,
      version: 2,
      content: "main window saved",
      contentHash: "b".repeat(64),
      currentContentHash: "b".repeat(64),
    }

    const refreshed = applyVaultEditorExternalSnapshot(dirty, current)

    expect(refreshed.draft).toBe("window two draft")
    expect(refreshed.base).toEqual(base)
    expect(refreshed.conflict).toEqual(current)
    expect(hasVaultEditorChanges(refreshed)).toBe(true)
  })

  it("protects dirty drafts from another project after switching to a clean project", () => {
    const dirtyProjectA = updateVaultEditorDraft(createVaultEditorState(base), "project A draft")
    const cleanProjectB = createVaultEditorState({ ...base, content: "project B" })
    const event = { preventDefault: vi.fn(), returnValue: "unchanged" }

    expect(
      protectUnsavedVaultDraftsBeforeUnload(event, {
        "project-a": { index: dirtyProjectA },
        "project-b": { index: cleanProjectB },
      }),
    ).toBe(true)
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(event.returnValue).toBe("")
  })

  it("rebases a successful save without discarding edits typed while it was pending", () => {
    const submitted = updateVaultEditorDraft(createVaultEditorState(base), "draft A")
    const editedWhileSaving = updateVaultEditorDraft(submitted, "draft B")
    const saved: VaultDocumentSnapshot = {
      ...base,
      version: 2,
      content: "draft A",
      contentHash: "b".repeat(64),
      currentContentHash: "b".repeat(64),
    }

    const rebased = rebaseVaultEditorAfterSave(editedWhileSaving, saved, submitted.revision)
    expect(rebased.base).toEqual(saved)
    expect(rebased.draft).toBe("draft B")
    expect(rebased.revision).toBe(editedWhileSaving.revision)
    expect(hasVaultEditorChanges(rebased)).toBe(true)

    const unchanged = rebaseVaultEditorAfterSave(submitted, saved, submitted.revision)
    expect(unchanged.draft).toBe("draft A")
    expect(hasVaultEditorChanges(unchanged)).toBe(false)
  })
})
