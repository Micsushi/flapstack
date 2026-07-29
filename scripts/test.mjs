#!/usr/bin/env node

import path from "node:path"
import { fileURLToPath } from "node:url"
import { packageBinStep, runCommandSequence } from "./lib/project-command.mjs"
import { runWithIsolatedTestGitEnvironment } from "./lib/test-git-environment.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const requestedArgs = process.argv.slice(2)
const windowsPlatformProductTest = "tests/windows-platform-product.test.ts"
const hasExplicitTestFilter = requestedArgs.some(
  (argument) => argument.startsWith("tests/") || /\.test\.[cm]?[jt]sx?$/i.test(argument),
)
const splitWindowsPlatformProductTest = process.platform === "win32" && !hasExplicitTestFilter
const vitestArgs = [
  "run",
  ...requestedArgs,
  ...(splitWindowsPlatformProductTest ? ["--exclude", windowsPlatformProductTest] : []),
]

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
        packageBinStep("tests", "vitest", "vitest", vitestArgs, { root }),
        ...(splitWindowsPlatformProductTest
          ? [
              packageBinStep(
                "Windows platform product tests",
                "vitest",
                "vitest",
                ["run", windowsPlatformProductTest, "--maxWorkers=1"],
                { root },
              ),
            ]
          : []),
      ],
      { env: isolatedGitEnv },
    ),
  )
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
