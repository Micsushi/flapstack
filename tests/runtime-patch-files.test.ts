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
})
