#!/usr/bin/env node

import path from "node:path"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import {
  assertPortablePackageScripts,
  packageBinStep,
  runCommandSequence,
} from "./lib/project-command.mjs"
import { runWithIsolatedTestGitEnvironment } from "./lib/test-git-environment.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const node = process.execPath
const portableLinux = process.argv.includes("--portable-linux")
const vitestArgs = ["run"]

if (portableLinux) {
  for (const windowsOnlyTest of [
    "tests/windows-process-inspection.test.ts",
    "tests/windows-toolchain.test.ts",
  ]) {
    vitestArgs.push("--exclude", windowsOnlyTest)
  }
}

assertPortablePackageScripts(JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")), [
  "build",
  "check",
  "lint",
  "format",
  "style:check",
  "test",
  "postinstall",
  "preinstall",
  "release:local",
])

try {
  runWithIsolatedTestGitEnvironment((isolatedGitEnv) =>
    runCommandSequence(
      [
        packageBinStep("lint", "eslint", "eslint", ["."], { root }),
        packageBinStep("style", "prettier", "prettier", ["--check", "."], { root }),
        packageBinStep("typecheck", "typescript", "tsc", ["--noEmit"], { root }),
        {
          label: "native Node ABI",
          command: node,
          args: [path.join(root, "scripts", "ensure-native-abi.mjs"), "node"],
          cwd: root,
        },
        packageBinStep("tests", "vitest", "vitest", vitestArgs, { root }),
        {
          label: "build",
          command: node,
          args: [path.join(root, "scripts", "build.mjs")],
          cwd: root,
        },
      ],
      { env: isolatedGitEnv },
    ),
  )
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
