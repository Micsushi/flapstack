import { describe, expect, it } from "vitest"
import {
  extractChangedFiles,
  fileChangeOutcome,
} from "../src/renderer/features/agents/utils/git-activity"

describe("Runtime patch file projection", () => {
  it("feeds structured ApplyPatch changes into changed-file UI stats", () => {
    expect(
      extractChangedFiles(
        [
          {
            type: "tool-ApplyPatch",
            state: "output-available",
            input: {
              changes: [
                {
                  path: "/repo/src/app.ts",
                  diff: "--- a/src/app.ts\n+++ b/src/app.ts\n-old\n+new\n+added",
                },
                { path: "/repo/src/new.ts", diff: "+created" },
              ],
            },
          },
        ],
        "/repo",
      ),
    ).toEqual([
      { filePath: "/repo/src/app.ts", displayPath: "src/app.ts", additions: 2, deletions: 1 },
      { filePath: "/repo/src/new.ts", displayPath: "src/new.ts", additions: 1, deletions: 0 },
    ])
  })

  it("does not credit one aggregate patch to every changed path", () => {
    expect(
      extractChangedFiles([
        {
          type: "tool-ApplyPatch",
          state: "output-available",
          input: {
            changes: [{ path: "/repo/src/a.ts" }, { path: "/repo/src/b.ts" }],
            diff: "--- a/src/a.ts\n+++ b/src/a.ts\n-old\n+new",
          },
        },
      ]),
    ).toEqual([
      { filePath: "/repo/src/a.ts", displayPath: "a.ts", additions: 1, deletions: 1 },
      { filePath: "/repo/src/b.ts", displayPath: "b.ts", additions: 0, deletions: 0 },
    ])
  })

  it("counts no file for a declined Codex or Gemini patch, failed Claude Write or unfinished proposal", () => {
    const patch = { type: "tool-ApplyPatch", input: { path: "note.txt", diff: "+line" } }
    const write = { type: "tool-Write", input: { file_path: "note.txt", content: "line" } }
    expect(
      extractChangedFiles([{ ...write, state: "output-available" }], "/repo", "durable-run"),
    ).toEqual([])
    expect(
      fileChangeOutcome({
        ...write,
        state: "output-error",
        errorText: "Error: User denied the tool request.",
      }),
    ).toBe("denied")
    expect(fileChangeOutcome({ ...write, state: "output-error", errorText: "Disk full" })).toBe(
      "failed",
    )
    expect(
      extractChangedFiles([
        { ...patch, state: "output-available", output: { state: "declined" } },
        { ...write, state: "output-error", errorText: "User denied the tool request." },
        { ...patch, state: "input-available" },
        { ...write, state: "input-streaming" },
        { ...patch, state: "output-available", output: { state: "failed" } },
      ]),
    ).toEqual([])
    expect(
      extractChangedFiles([{ ...write, state: "result", result: { filePath: "note.txt" } }]),
    ).toMatchObject([{ filePath: "note.txt", additions: 1 }])
  })
})
