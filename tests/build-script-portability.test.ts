import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
// @ts-expect-error JavaScript build-script helper intentionally has no declaration file.
import {
  assertPortablePackageScripts,
  resolvePackageBin,
  runCommandSequence,
} from "../scripts/lib/project-command.mjs"

function packageFixture(manifest: Record<string, unknown>) {
  const root = mkdtempSync(join(tmpdir(), "flapstack-command-test-"))
  const packageDirectory = join(root, "node_modules", "fixture-package")
  mkdirSync(join(packageDirectory, "bin"), { recursive: true })
  writeFileSync(join(packageDirectory, "package.json"), JSON.stringify(manifest))
  writeFileSync(join(packageDirectory, "bin", "cli.mjs"), "process.exit(0)\n")
  return root
}

describe("portable project commands", () => {
  it("rejects non-portable root scripts by behavior instead of matching known source text", () => {
    const required = ["build", "check"]
    expect(() =>
      assertPortablePackageScripts(
        { scripts: { build: "node scripts/build.mjs", check: "node scripts/check.mjs" } },
        required,
      ),
    ).not.toThrow()
    for (const command of [
      "sh -c build",
      "rm -rf out",
      "NODE_OPTIONS=--max-old-space-size=1 node build.mjs",
    ]) {
      expect(() =>
        assertPortablePackageScripts(
          { scripts: { build: command, check: "node scripts/check.mjs" } },
          required,
        ),
      ).toThrow(/not portable/i)
    }
    expect(() => assertPortablePackageScripts({ scripts: {} }, required)).toThrow(
      /missing required npm script/i,
    )
  })

  it("pins the accepted Node and npm toolchain", () => {
    const manifest = JSON.parse(readFileSync("package.json", "utf8"))
    expect(manifest.engines).toEqual({ node: ">=22 <23", npm: ">=10 <11" })
    expect(manifest.packageManager).toBe("npm@10.9.2")
    expect(readFileSync(".nvmrc", "utf8").trim()).toBe("22")
    expect(readFileSync(".node-version", "utf8").trim()).toBe("22")
    expect(readFileSync(".python-version", "utf8").trim()).toBe("3.11")
    const lock = JSON.parse(readFileSync("package-lock.json", "utf8"))
    expect(lock.packages[""].engines).toEqual(manifest.engines)
  })

  it("resolves a package JavaScript bin without relying on Windows command shims", () => {
    const root = packageFixture({ name: "fixture-package", bin: { fixture: "bin/cli.mjs" } })

    expect(resolvePackageBin("fixture-package", "fixture", { root })).toBe(
      join(root, "node_modules", "fixture-package", "bin", "cli.mjs"),
    )
  })

  it("rejects a missing or escaping package bin", () => {
    const missing = packageFixture({ name: "fixture-package", bin: {} })
    expect(() => resolvePackageBin("fixture-package", "fixture", { root: missing })).toThrow(
      "does not declare bin fixture",
    )

    const escaping = packageFixture({ name: "fixture-package", bin: { fixture: "../outside.js" } })
    expect(() => resolvePackageBin("fixture-package", "fixture", { root: escaping })).toThrow(
      "escapes its package directory",
    )
  })

  it("runs ordered gates and stops on first failure", () => {
    const runner = vi
      .fn()
      .mockReturnValueOnce({ status: 0, signal: null })
      .mockReturnValueOnce({ status: 7, signal: null })

    expect(() =>
      runCommandSequence(
        [
          { label: "lint", command: "node", args: ["lint.js"] },
          { label: "test", command: "node", args: ["test.js"] },
          { label: "build", command: "node", args: ["build.js"] },
        ],
        { runner },
      ),
    ).toThrow("test failed with exit code 7")
    expect(runner).toHaveBeenCalledTimes(2)
  })

  it("reports spawn errors instead of emitting an unhandled error event", () => {
    const runner = vi.fn().mockReturnValue({
      status: null,
      signal: null,
      error: Object.assign(new Error("spawn prettier ENOENT"), { code: "ENOENT" }),
    })

    expect(() =>
      runCommandSequence([{ label: "style", command: "prettier", args: [] }], { runner }),
    ).toThrow("style could not start: spawn prettier ENOENT")
  })
})
