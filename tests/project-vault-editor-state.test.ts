import { describe, expect, it } from "vitest"

import {
  createVaultEditorState,
  hasVaultEditorChanges,
  markVaultEditorConflict,
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
})
