import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, dirname, join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { resolveClaudeBinaryPath } from "../src/main/lib/claude/binary"

describe("Claude binary resolution", () => {
  let directory = ""

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "flapstack-claude-binary-"))
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  function executable(path: string) {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, "test")
    chmodSync(path, 0o755)
  }

  it("prefers the pinned bundled binary", () => {
    const bundled = join(directory, "app", "resources", "bin", "darwin-arm64", "claude")
    const global = join(directory, "global", "claude")
    executable(bundled)
    executable(global)

    expect(
      resolveClaudeBinaryPath({
        isPackaged: false,
        appPath: join(directory, "app"),
        resourcesPath: join(directory, "resources"),
        platform: "darwin",
        arch: "arm64",
        searchPath: join(directory, "global"),
      }),
    ).toEqual({ path: bundled, source: "bundled" })
  })

  it("uses a real PATH executable only for development", () => {
    const global = join(directory, "global", "claude")
    executable(global)
    const shared = {
      appPath: join(directory, "app"),
      resourcesPath: join(directory, "resources"),
      platform: "darwin" as const,
      arch: "arm64",
      searchPath: [join(directory, "missing"), join(directory, "global")].join(delimiter),
    }

    expect(resolveClaudeBinaryPath({ ...shared, isPackaged: false })).toEqual({
      path: global,
      source: "path",
    })
    expect(resolveClaudeBinaryPath({ ...shared, isPackaged: true })).toEqual({
      path: join(directory, "resources", "bin", "claude"),
      source: "missing",
    })
  })
})
