import { createHash } from "node:crypto"
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  applyUnifiedPatch,
  createProjectLocalModelWriteToolExecutor,
  LOCAL_MODEL_WRITE_TOOL_SCHEMAS,
  type LocalModelWriteApprovalDecision,
} from "../src/main/lib/harness/local-model-write-tools"
import type { LocalModelReadToolExecutor } from "../src/main/lib/harness/local-model-read-tools"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("local model project-write tools", () => {
  it("publishes exact edit, write, and patch schemas", () => {
    expect(LOCAL_MODEL_WRITE_TOOL_SCHEMAS.map((tool) => tool.function.name)).toEqual([
      "edit_file",
      "write_file",
      "apply_patch",
    ])
    expect(
      LOCAL_MODEL_WRITE_TOOL_SCHEMAS.every(
        (tool) => tool.function.parameters.additionalProperties === false,
      ),
    ).toBe(true)
  })

  it("denies read-only mutation, traversal, and symlink escape", async () => {
    const root = fixture()
    const outside = temporaryDirectory("flapstack-local-write-outside-")
    writeFileSync(join(outside, "secret.txt"), "outside\n")
    symlinkSync(outside, join(root, "escape"))

    const readOnly = executor(root, { permissionMode: "read-only", projectWriteAllowed: false })
    await expect(
      execute(readOnly, "write_file", {
        path: "README.md",
        content: "mutated\n",
        expected_sha256: hash("before\n"),
      }),
    ).resolves.toMatchObject({ ok: false, errorCode: "permission-denied" })
    expect(readFileSync(join(root, "README.md"), "utf8")).toBe("before\n")

    const writer = executor(root)
    await expect(
      execute(writer, "write_file", {
        path: "../outside.txt",
        content: "blocked\n",
        expected_sha256: null,
      }),
    ).resolves.toMatchObject({ ok: false, errorCode: "path-denied" })
    await expect(
      execute(writer, "write_file", {
        path: "escape/secret.txt",
        content: "blocked\n",
        expected_sha256: hash("outside\n"),
      }),
    ).resolves.toMatchObject({ ok: false, errorCode: "path-denied" })
    expect(readFileSync(join(outside, "secret.txt"), "utf8")).toBe("outside\n")
  })

  it("atomically creates, edits, replaces, and patches exact project files", async () => {
    const root = fixture()
    const writer = executor(root)
    chmodSync(join(root, "README.md"), 0o755)

    await expect(
      execute(writer, "write_file", {
        path: "new.txt",
        content: "created\n",
        expected_sha256: null,
      }),
    ).resolves.toMatchObject({ ok: true })
    expect(readFileSync(join(root, "new.txt"), "utf8")).toBe("created\n")

    await expect(
      execute(writer, "edit_file", {
        path: "README.md",
        old_text: "before",
        new_text: "after",
        expected_sha256: hash("before\n"),
      }),
    ).resolves.toMatchObject({ ok: true })
    expect(readFileSync(join(root, "README.md"), "utf8")).toBe("after\n")

    const patch =
      "--- a/src/value.ts\n+++ b/src/value.ts\n@@ -1,2 +1,2 @@\n export const one = 1\n-export const two = 2\n+export const two = 3\n"
    await expect(
      execute(writer, "apply_patch", {
        path: "src/value.ts",
        patch,
        expected_sha256: hash("export const one = 1\nexport const two = 2\n"),
      }),
    ).resolves.toMatchObject({ ok: true })
    expect(readFileSync(join(root, "src/value.ts"), "utf8")).toBe(
      "export const one = 1\nexport const two = 3\n",
    )

    await expect(
      execute(writer, "write_file", {
        path: "README.md",
        content: "whole replacement\n",
        expected_sha256: hash("after\n"),
      }),
    ).resolves.toMatchObject({ ok: true })
    expect(readFileSync(join(root, "README.md"), "utf8")).toBe("whole replacement\n")
    expect(lstatSync(join(root, "README.md")).mode & 0o777).toBe(0o755)
  })

  it("blocks stale content and an in-place change immediately before commit", async () => {
    const root = fixture()
    const stale = executor(root)
    await expect(
      execute(stale, "write_file", {
        path: "README.md",
        content: "model\n",
        expected_sha256: hash("wrong\n"),
      }),
    ).resolves.toMatchObject({ ok: false, errorCode: "stale-file" })

    const raced = executor(root, {
      beforeCommit: () => writeFileSync(join(root, "README.md"), "human\n"),
    })
    await expect(
      execute(raced, "write_file", {
        path: "README.md",
        content: "model\n",
        expected_sha256: hash("before\n"),
      }),
    ).resolves.toMatchObject({ ok: false, errorCode: "stale-file" })
    expect(readFileSync(join(root, "README.md"), "utf8")).toBe("human\n")
  })

  it("blocks a parent symlink swap before atomic commit", async () => {
    if (process.platform === "win32") return
    const root = fixture()
    const outside = temporaryDirectory("flapstack-local-write-swap-")
    writeFileSync(join(outside, "value.ts"), "outside\n")
    const writer = executor(root, {
      beforeCommit: () => {
        rmSync(join(root, "src"), { recursive: true, force: true })
        symlinkSync(outside, join(root, "src"))
      },
    })

    await expect(
      execute(writer, "write_file", {
        path: "src/value.ts",
        content: "escaped\n",
        expected_sha256: hash("export const one = 1\nexport const two = 2\n"),
      }),
    ).resolves.toMatchObject({ ok: false, errorCode: "path-denied" })
    expect(readFileSync(join(outside, "value.ts"), "utf8")).toBe("outside\n")
  })

  it("revalidates the registered root at the final commit seam", async () => {
    const root = fixture()
    const verifyRoot = vi
      .fn<() => string>()
      .mockReturnValueOnce(root)
      .mockReturnValueOnce(root)
      .mockImplementationOnce(() => {
        throw new Error("registration removed")
      })
    const writer = executor(root, { verifyRoot })

    await expect(
      execute(writer, "write_file", {
        path: "README.md",
        content: "blocked\n",
        expected_sha256: hash("before\n"),
      }),
    ).resolves.toMatchObject({ ok: false, errorCode: "unregistered-root" })
    expect(verifyRoot).toHaveBeenCalledTimes(3)
    expect(readFileSync(join(root, "README.md"), "utf8")).toBe("before\n")
  })

  it("keeps ask mode pending and mutates only after explicit approval", async () => {
    const root = fixture()
    let decide!: (decision: LocalModelWriteApprovalDecision) => void
    const requestApproval = vi.fn(
      () =>
        new Promise<LocalModelWriteApprovalDecision>((resolve) => {
          decide = resolve
        }),
    )
    const writer = executor(root, { permissionMode: "ask-before-edits", requestApproval })
    const pending = execute(writer, "write_file", {
      path: "README.md",
      content: "approved\n",
      expected_sha256: hash("before\n"),
    })

    await vi.waitFor(() => expect(requestApproval).toHaveBeenCalledOnce())
    expect(readFileSync(join(root, "README.md"), "utf8")).toBe("before\n")
    decide("approved")
    await expect(pending).resolves.toMatchObject({ ok: true })
    expect(readFileSync(join(root, "README.md"), "utf8")).toBe("approved\n")

    const denied = executor(root, {
      permissionMode: "ask-before-edits",
      requestApproval: async () => "denied",
    })
    await expect(
      execute(denied, "write_file", {
        path: "README.md",
        content: "denied\n",
        expected_sha256: hash("approved\n"),
      }),
    ).resolves.toMatchObject({ ok: false, errorCode: "approval-denied" })
    expect(readFileSync(join(root, "README.md"), "utf8")).toBe("approved\n")
  })

  it("rolls back replacement and creation when post-commit finalization fails", async () => {
    const root = fixture()
    const writer = executor(root, {
      afterCommit: () => {
        throw new Error("injected post-commit failure")
      },
    })

    await expect(
      execute(writer, "write_file", {
        path: "README.md",
        content: "temporary\n",
        expected_sha256: hash("before\n"),
      }),
    ).resolves.toMatchObject({ ok: false, errorCode: "write-failed" })
    expect(readFileSync(join(root, "README.md"), "utf8")).toBe("before\n")

    await expect(
      execute(writer, "write_file", {
        path: "new.txt",
        content: "temporary\n",
        expected_sha256: null,
      }),
    ).resolves.toMatchObject({ ok: false, errorCode: "write-failed" })
    expect(() => readFileSync(join(root, "new.txt"), "utf8")).toThrow()
  })

  it("rejects ambiguous edits and patch context drift", async () => {
    const root = fixture()
    writeFileSync(join(root, "repeat.txt"), "same\nsame\n")
    const writer = executor(root)
    await expect(
      execute(writer, "edit_file", {
        path: "repeat.txt",
        old_text: "same",
        new_text: "new",
        expected_sha256: hash("same\nsame\n"),
      }),
    ).resolves.toMatchObject({ ok: false, errorCode: "invalid-tool-arguments" })
    await expect(
      execute(writer, "apply_patch", {
        path: "README.md",
        patch: "@@ -1 +1 @@\n-wrong\n+new\n",
        expected_sha256: hash("before\n"),
      }),
    ).resolves.toMatchObject({ ok: false, errorCode: "invalid-tool-arguments" })
  })
})

describe("unified patch helper", () => {
  it("applies multiple ordered hunks", () => {
    expect(
      applyUnifiedPatch(
        "one\ntwo\nthree\nfour\n",
        "@@ -1,2 +1,2 @@\n one\n-two\n+TWO\n@@ -3,2 +3,2 @@\n three\n-four\n+FOUR\n",
      ),
    ).toBe("one\nTWO\nthree\nFOUR\n")
  })
})

function fixture(): string {
  const root = temporaryDirectory("flapstack-local-write-tools-")
  mkdirSync(join(root, "src"))
  writeFileSync(join(root, "README.md"), "before\n")
  writeFileSync(join(root, "src", "value.ts"), "export const one = 1\nexport const two = 2\n")
  return root
}

function temporaryDirectory(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix))
  roots.push(root)
  return root
}

function executor(
  root: string,
  overrides: Partial<Parameters<typeof createProjectLocalModelWriteToolExecutor>[0]> = {},
) {
  return createProjectLocalModelWriteToolExecutor({
    rootPath: root,
    runId: "run-1",
    chatId: "chat-1",
    permissionMode: "auto-edit-project-only",
    projectWriteAllowed: true,
    verifyRoot: () => root,
    ...overrides,
  })
}

function execute(executor: LocalModelReadToolExecutor, name: string, args: unknown) {
  return executor.execute({ id: "call-1", name, arguments: args }, new AbortController().signal)
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}
