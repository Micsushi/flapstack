import { describe, expect, it, vi } from "vitest"
import {
  buildManifestEntriesFromSnapshots,
  type CheckpointStatusSnapshot,
} from "../src/main/lib/checkpoints"

vi.mock("electron", () => ({
  app: {
    getPath: () => "/tmp/flapstack-test",
    isPackaged: false,
  },
}))

function snapshot(files: CheckpointStatusSnapshot["files"]): CheckpointStatusSnapshot {
  return {
    available: true,
    files,
  }
}

describe("checkpoint manifest helpers", () => {
  it("returns an explicit no-change marker when checkpoint snapshots match", () => {
    const before = snapshot({
      "src/app.ts": {
        path: "src/app.ts",
        index: " ",
        workingTree: "M",
        hash: "same-hash",
        missing: false,
      },
    })

    const after = snapshot({
      "src/app.ts": {
        path: "src/app.ts",
        index: " ",
        workingTree: "M",
        hash: "same-hash",
        missing: false,
      },
    })

    expect(buildManifestEntriesFromSnapshots(before, after)).toEqual([
      {
        filePath: "",
        changeType: "none",
        additions: 0,
        deletions: 0,
        beforeHash: null,
        afterHash: null,
      },
    ])
  })

  it("summarizes added, modified, and deleted files from before and after snapshots", () => {
    const before = snapshot({
      "deleted.txt": {
        path: "deleted.txt",
        index: " ",
        workingTree: "M",
        hash: "deleted-before",
        missing: false,
      },
      "modified.ts": {
        path: "modified.ts",
        index: " ",
        workingTree: "M",
        hash: "modified-before",
        missing: false,
      },
    })

    const after = snapshot({
      "added.md": {
        path: "added.md",
        index: "?",
        workingTree: "?",
        hash: "added-after",
        missing: false,
      },
      "modified.ts": {
        path: "modified.ts",
        index: " ",
        workingTree: "M",
        hash: "modified-after",
        missing: false,
      },
    })

    const diffStats = new Map([
      ["modified.ts", { additions: 4, deletions: 2 }],
      ["added.md", { additions: 3, deletions: 0 }],
    ])

    expect(buildManifestEntriesFromSnapshots(before, after, diffStats)).toEqual([
      {
        filePath: "added.md",
        changeType: "added",
        additions: 3,
        deletions: 0,
        beforeHash: null,
        afterHash: "added-after",
      },
      {
        filePath: "deleted.txt",
        changeType: "deleted",
        additions: 0,
        deletions: 0,
        beforeHash: "deleted-before",
        afterHash: null,
      },
      {
        filePath: "modified.ts",
        changeType: "modified",
        additions: 4,
        deletions: 2,
        beforeHash: "modified-before",
        afterHash: "modified-after",
      },
    ])
  })
})
