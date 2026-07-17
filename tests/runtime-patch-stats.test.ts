import { describe, expect, it } from "vitest"
import { runtimePatchStats } from "../src/renderer/features/agents/utils/runtime-patch-stats"

describe("Runtime patch stats", () => {
  it("splits standard multi-file unified diffs before counting", () => {
    const aggregateDiff = [
      "--- a/src/first.ts",
      "+++ b/src/first.ts",
      "@@ -1 +1 @@",
      "-old first",
      "+new first",
      "--- a/src/second.ts",
      "+++ b/src/second.ts",
      "@@ -1 +1,2 @@",
      " old second",
      "+added second",
    ].join("\n")

    expect(
      runtimePatchStats({
        filePath: "/repo/src/first.ts",
        aggregateDiff,
        changeCount: 2,
      }),
    ).toEqual({ additions: 1, deletions: 1 })
    expect(
      runtimePatchStats({
        filePath: "/repo/src/second.ts",
        aggregateDiff,
        changeCount: 2,
      }),
    ).toEqual({ additions: 1, deletions: 0 })
  })

  it("refuses ambiguous basename-only attribution", () => {
    const aggregateDiff = [
      "diff --git a/src/index.ts b/src/index.ts",
      "--- a/src/index.ts",
      "+++ b/src/index.ts",
      "@@ -0,0 +1 @@",
      "+src",
      "diff --git a/test/index.ts b/test/index.ts",
      "--- a/test/index.ts",
      "+++ b/test/index.ts",
      "@@ -0,0 +1 @@",
      "+test",
    ].join("\n")

    expect(runtimePatchStats({ filePath: "index.ts", aggregateDiff, changeCount: 2 })).toEqual({
      additions: 0,
      deletions: 0,
    })
    expect(
      runtimePatchStats({ filePath: "/repo/src/index.ts", aggregateDiff, changeCount: 2 }),
    ).toEqual({ additions: 1, deletions: 0 })
  })
})
