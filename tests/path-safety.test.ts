import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { resolveInsideRoot } from "../src/main/lib/path-safety"

let rootPath: string

beforeEach(() => {
  rootPath = mkdtempSync(join(tmpdir(), "flapstack-path-safety-"))
})

afterEach(() => {
  rmSync(rootPath, { recursive: true, force: true })
})

describe("resolveInsideRoot", () => {
  it("resolves relative paths under the root", () => {
    expect(resolveInsideRoot(rootPath, "notes/context.txt")).toBe(
      join(rootPath, "notes/context.txt"),
    )
  })

  it("rejects path traversal", () => {
    expect(() => resolveInsideRoot(rootPath, "../outside.txt")).toThrow("escapes root")
  })

  it("rejects absolute paths", () => {
    expect(() => resolveInsideRoot(rootPath, join(rootPath, "absolute.txt"))).toThrow(
      "must be relative",
    )
  })
})
