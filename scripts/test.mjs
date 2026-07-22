#!/usr/bin/env node

import path from "node:path"
import { fileURLToPath } from "node:url"
import { packageBinStep, runCommandSequence } from "./lib/project-command.mjs"
import { runWithIsolatedTestGitEnvironment } from "./lib/test-git-environment.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

try {
  runWithIsolatedTestGitEnvironment((isolatedGitEnv) =>
    runCommandSequence(
      [
        {
          label: "native Node ABI",
          command: process.execPath,
          args: [path.join(root, "scripts", "ensure-native-abi.mjs"), "node"],
          cwd: root,
        },
        packageBinStep("tests", "vitest", "vitest", ["run", ...process.argv.slice(2)], { root }),
      ],
      { env: isolatedGitEnv },
    ),
  )
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
