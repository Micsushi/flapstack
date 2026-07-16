import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  resolveWorktreeFolderName,
  sanitizeWorktreeName,
} from "../src/main/lib/git/worktree-naming"

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe("worktree naming", () => {
  it("turns a user-facing name into a safe worktree folder label", () => {
    expect(sanitizeWorktreeName("  Fancy Feature_Name  ")).toBe("fancy-feature-name")
  })

  it("rejects names that cannot produce a folder", () => {
    expect(() => sanitizeWorktreeName("../..")).toThrow(
      "Enter a worktree name using letters or numbers.",
    )
  })

  it("refuses to reuse an existing folder in the selected location", () => {
    const parent = mkdtempSync(join(tmpdir(), "flapstack-worktree-name-"))
    temporaryDirectories.push(parent)
    mkdirSync(join(parent, "feature-name"))

    expect(() => resolveWorktreeFolderName(parent, "Feature Name")).toThrow(
      'A folder named "feature-name" already exists in this location.',
    )
  })
})
