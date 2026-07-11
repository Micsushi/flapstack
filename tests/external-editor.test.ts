import { describe, expect, it } from "vitest"
import {
  editorCommandsForPlatform,
  editorFileArgs,
  editorLookupCommand,
} from "../src/main/lib/external/editor-file-args"

describe("terminal editor file links", () => {
  it("uses goto syntax for Cursor and VS Code", () => {
    expect(editorFileArgs("cursor", "src/main.ts", 12, 7)).toEqual(["--goto", "src/main.ts:12:7"])
    expect(editorFileArgs("code", "src/main.ts", 12)).toEqual(["--goto", "src/main.ts:12:1"])
  })

  it("uses positional source locations for Sublime and Atom", () => {
    expect(editorFileArgs("subl", "src/main.ts", 12, 7)).toEqual(["src/main.ts:12:7"])
    expect(editorFileArgs("atom", "src/main.ts", 12)).toEqual(["src/main.ts:12:1"])
  })

  it("keeps plain-file arguments when no line is present", () => {
    expect(editorFileArgs("cursor", "src/main.ts")).toEqual(["src/main.ts"])
    expect(editorFileArgs("open", "src/main.ts", 12, 7)).toEqual(["-t", "src/main.ts"])
  })

  it("uses where.exe and preserves goto-capable editors on Windows", () => {
    expect(editorLookupCommand("win32", "cursor")).toEqual({
      command: "where.exe",
      args: ["cursor"],
    })
    expect(editorCommandsForPlatform("win32")).toEqual(["cursor", "code", "subl", "atom"])
  })

  it("uses macOS open only on macOS", () => {
    expect(editorCommandsForPlatform("darwin")).toContain("open")
    expect(editorCommandsForPlatform("linux")).not.toContain("open")
  })
})
