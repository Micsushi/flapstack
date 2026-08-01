import { readFile } from "node:fs/promises"

import {
  applyPortableImport,
  type PortableConflictResolution,
} from "../../src/main/lib/portability/importer"

type CrashInput = {
  crashAt: "after-git-exclusion" | "after-file-publish" | "after-database-committed"
  planId: string
  expectedFingerprint: string
  expectedConfirmationHash: string
  databasePath: string
  stateRoot: string
  targetRoots: {
    projects: Record<string, string>
    projectVaults: Record<string, string>
  }
  resolutions: Record<string, PortableConflictResolution>
}

async function main(): Promise<void> {
  const inputPath = process.argv[2]
  if (!inputPath) throw new Error("Crash fixture input path is required.")
  const input = JSON.parse(await readFile(inputPath, "utf8")) as CrashInput

  await applyPortableImport({
    ...input,
    hooks: {
      afterGitExclusionMutation: () => {
        if (input.crashAt === "after-git-exclusion") process.exit(91)
      },
      afterFilePublish: () => {
        if (input.crashAt === "after-file-publish") process.exit(92)
      },
      afterDatabaseCommittedJournal: () => {
        if (input.crashAt === "after-database-committed") process.exit(93)
      },
    },
  })

  process.exit(0)
}

void main()
