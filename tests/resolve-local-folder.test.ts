import { describe, expect, it } from "vitest"
import { resolveLocalFolder } from "../src/renderer/features/agents/lib/resolve-local-folder"

describe("resolveLocalFolder", () => {
  it("prefers the selected target worktree", () => {
    expect(resolveLocalFolder("/target", "/chat", "/project")).toBe("/target")
  })

  it("falls back to the chat worktree and then the project folder", () => {
    expect(resolveLocalFolder(null, "/chat", "/project")).toBe("/chat")
    expect(resolveLocalFolder(undefined, null, "/project")).toBe("/project")
  })

  it("returns undefined when the chat has no local folder", () => {
    expect(resolveLocalFolder(null, undefined, null)).toBeUndefined()
  })
})
