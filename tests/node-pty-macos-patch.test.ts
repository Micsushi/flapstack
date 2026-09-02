import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
// @ts-expect-error JavaScript build-script helper intentionally has no declaration file.
import { patchInstalledNodePty, patchNodePtyMacosSource } from "../scripts/patch-node-pty-macos.mjs"

describe("node-pty macOS descriptor patch", () => {
  it("does not inspect or modify node-pty on other platforms", () => {
    expect(patchInstalledNodePty({ packageRoot: "/missing", platform: "win32" })).toBe(false)
  })

  it.skipIf(process.platform !== "darwin")(
    "keeps the pinned native source on the upstream descriptor-safe paths",
    () => {
      const source = readFileSync(resolve("node_modules/node-pty/src/unix/pty.cc"), "utf8")
      const patched = patchNodePtyMacosSource(source)

      expect(patched.changed).toBe(false)
      expect(patched.source).toContain("    close(kq);")
      expect(patched.source).toContain("bool spawn_succeeded = false;")
      expect(patched.source).toContain("if (slave >= 0)")
      expect(patched.source).toContain("for (size_t i = 0; i < low_fd_count; i++)")
      expect(patched.source).toContain("if (!spawn_succeeded && *master >= 0)")
      expect(patched.source).toContain("close(master);")
      const spawnFunction = patched.source.slice(
        patched.source.indexOf("static void\npty_posix_spawn"),
        patched.source.indexOf("\n#endif", patched.source.indexOf("static void\npty_posix_spawn")),
      )
      expect(spawnFunction).not.toContain("return;")
    },
  )
})
