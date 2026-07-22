import { lstat, mkdir, mkdtemp, readFile, readlink, rm, symlink } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  planInverseFileContent,
  planInverseFileState,
  resolveSafeUndoPath,
  writeUndoFileState,
} from "../src/main/lib/run-change-undo"

const buffer = (value: string) => Buffer.from(value)
const temporaryDirectories: string[] = []

async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), "flapstack-undo-test-"))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe("run change undo planning", () => {
  it("restores exact after-content to before-content", async () => {
    const result = await planInverseFileContent(
      buffer("after\n"),
      buffer("after\n"),
      buffer("before\n"),
    )
    expect(result.conflict).toBeUndefined()
    expect(result.result?.toString()).toBe("before\n")
  })

  it("preserves non-overlapping later edits", async () => {
    const result = await planInverseFileContent(
      buffer("title\nafter\nline 3\nline 4\nline 5\nline 6\nlater addition\n"),
      buffer("title\nafter\nline 3\nline 4\nline 5\nline 6\n"),
      buffer("title\nbefore\nline 3\nline 4\nline 5\nline 6\n"),
    )
    expect(result.conflict).toBeUndefined()
    expect(result.result?.toString()).toBe(
      "title\nbefore\nline 3\nline 4\nline 5\nline 6\nlater addition\n",
    )
  })

  it("blocks overlapping later edits", async () => {
    const result = await planInverseFileContent(
      buffer("title\nmanual replacement\n"),
      buffer("title\nafter\n"),
      buffer("title\nbefore\n"),
    )
    expect(result.conflict).toBe("Later changes overlap this response")
    expect(result.result).toBeUndefined()
  })

  it("removes a newly added file only when it still matches", async () => {
    const clean = await planInverseFileContent(buffer("new\n"), buffer("new\n"), null)
    expect(clean).toEqual({ result: null })

    const changed = await planInverseFileContent(buffer("new and edited\n"), buffer("new\n"), null)
    expect(changed.conflict).toBe("File existence changed after this response")
  })

  it("restores a deleted file only while it remains deleted", async () => {
    const clean = await planInverseFileContent(null, null, buffer("restored\n"))
    expect(clean.result?.toString()).toBe("restored\n")

    const replaced = await planInverseFileContent(
      buffer("replacement\n"),
      null,
      buffer("restored\n"),
    )
    expect(replaced.conflict).toBe("File existence changed after this response")
  })

  it("preserves an executable mode while reversing content", async () => {
    const planned = await planInverseFileState(
      { content: buffer("after\n"), kind: "file", mode: 0o755 },
      { content: buffer("after\n"), kind: "file", mode: 0o755 },
      { content: buffer("before\n"), kind: "file", mode: 0o755 },
    )
    expect(planned.conflict).toBeUndefined()
    expect(planned.result).toMatchObject({ kind: "file", mode: 0o755 })

    const root = await temporaryDirectory()
    const path = join(root, "script.sh")
    await writeUndoFileState(root, path, planned.result ?? null)
    if (process.platform !== "win32") expect((await lstat(path)).mode & 0o777).toBe(0o755)
    expect(await readFile(path, "utf8")).toBe("before\n")
  })

  it("blocks an overlapping executable-mode change", async () => {
    await expect(
      planInverseFileState(
        { content: buffer("after\n"), kind: "file", mode: 0o644 },
        { content: buffer("after\n"), kind: "file", mode: 0o755 },
        { content: buffer("before\n"), kind: "file", mode: 0o644 },
      ),
    ).resolves.toEqual({ conflict: "File mode changed after this response" })
  })

  it("restores symlinks as symlinks", async () => {
    if (process.platform === "win32") return
    const root = await temporaryDirectory()
    const path = join(root, "current-link")
    await writeUndoFileState(root, path, {
      content: buffer("target.txt"),
      kind: "symlink",
      mode: 0o777,
    })
    expect((await lstat(path)).isSymbolicLink()).toBe(true)
    expect(await readlink(path)).toBe("target.txt")
  })

  it("rejects a symlinked parent that escapes the worktree", async () => {
    if (process.platform === "win32") return
    const root = await temporaryDirectory()
    const outside = await temporaryDirectory()
    await mkdir(join(outside, "nested"))
    await symlink(outside, join(root, "escape"))
    await expect(resolveSafeUndoPath(root, "escape/nested/file.txt")).rejects.toThrow(
      "Unsafe symlink parent",
    )
  })
})
