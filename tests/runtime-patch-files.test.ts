import { describe, expect, it } from "vitest"
import { extractChangedFiles } from "../src/renderer/features/agents/utils/git-activity"

describe("Runtime patch file projection", () => {
  it("feeds structured ApplyPatch changes into changed-file UI stats", () => {
    expect(
      extractChangedFiles(
        [
          {
            type: "tool-ApplyPatch",
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
})
