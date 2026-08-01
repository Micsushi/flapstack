import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

describe("project vault custom note file-management surface", () => {
  const source = readFileSync(
    resolve(
      process.cwd(),
      "src/renderer/features/project-vault/project-vault-custom-notes-panel.tsx",
    ),
    "utf8",
  )

  it("exposes the complete folder lifecycle with keyboard labels", () => {
    expect(source).toContain('aria-label="Manage vault folders and attachments"')
    expect(source).toContain('aria-label="Folder path"')
    expect(source).toContain('aria-label="New folder name"')
    expect(source).toContain("createFolder")
    expect(source).toContain("renameFolder")
    expect(source).toContain("removeFolder")
    expect(source).toContain("Create folder")
    expect(source).toContain("Rename folder")
    expect(source).toContain("Remove empty folder")
  })

  it("exposes safe raster upload, read, rename, move, remove, and restore controls", () => {
    expect(source).toContain('aria-label="Safe raster attachment file"')
    expect(source).toContain('accept="image/png,image/jpeg,image/gif,image/webp"')
    for (const operation of [
      "createAttachment",
      "readAttachment",
      "renameAttachment",
      "moveAttachment",
      "removeAttachment",
      "restoreAttachment",
    ]) {
      expect(source).toContain(operation)
    }
    expect(source).toContain("Load attachment")
    expect(source).toContain("Rename attachment")
    expect(source).toContain("Move attachment")
    expect(source).toContain("Move attachment to recoverable trash")
  })

  it("states exact safety limits and exposes truthful pending, error, and conflict status", () => {
    expect(source).toContain("PNG, JPEG, GIF, or WebP only")
    expect(source).toContain("16 MiB")
    expect(source).toContain("verifies the file signature")
    expect(source).not.toContain("any file")
    expect(source).toContain('role="status"')
    expect(source).toContain('aria-live="polite"')
    expect(source).toContain("Conflict:")
    expect(source).toContain("Reload the attachment")
  })
})
