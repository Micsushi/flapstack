import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  createProjectLocalModelWriteToolExecutor,
  type LocalModelWriteApprovalDecision,
} from "../src/main/lib/harness/local-model-write-tools"
import type { LocalModelReadToolExecutor } from "../src/main/lib/harness/local-model-read-tools"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("local model project-write tools", () => {
  it("denies read-only mutation, traversal, and symlink escape", async () => {
    const root = fixture()
    const outside = temporaryDirectory("flapstack-local-write-outside-")
    writeFileSync(join(outside, "secret.txt"), "outside\n")
    symlinkSync(outside, join(root, "escape"), process.platform === "win32" ? "junction" : "dir")

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
