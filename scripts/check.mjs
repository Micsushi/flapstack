#!/usr/bin/env node

import path from "node:path"
import { mkdtempSync, readFileSync, rmSync, rmdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import {
  assertPortablePackageScripts,
  packageBinStep,
  runCommandSequence,
} from "./lib/project-command.mjs"
import { runWithIsolatedTestGitEnvironment } from "./lib/test-git-environment.mjs"
import { reportTestInventory } from "./lib/test-inventory.mjs"

import { prepareProjectRecordsSource } from "./lib/project-records-source.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
prepareProjectRecordsSource(root)
const node = process.execPath
const portableLinux = process.argv.includes("--portable-linux")
const vitestArgs = ["run"]
const windowsPlatformProductTest = "tests/windows-platform-product.test.ts"

if (portableLinux) {
  vitestArgs.push("--exclude", "tests/windows-process-inspection.test.ts")
}

if (process.platform === "win32") {
  vitestArgs.push("--exclude", windowsPlatformProductTest)
}

const testSteps = [
  packageBinStep("tests", "vitest", "vitest", vitestArgs, { root }),
  ...(process.platform === "win32"
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
]

const commandSteps = [
  packageBinStep("lint", "eslint", "eslint", ["."], { root }),
  packageBinStep("style", "prettier", "prettier", ["--check", "."], { root }),
  packageBinStep("typecheck", "typescript", "tsc", ["--noEmit"], { root }),
  {
    label: "native Node ABI",
    command: node,
    args: [path.join(root, "scripts", "ensure-native-abi.mjs"), "node"],
    cwd: root,
  },
  {
    label: "Stage 6 Tier 2 ledger",
    command: node,
    args: [path.join(root, "scripts/check-stage6-tier2-ledger.mjs")],
    cwd: root,
  },
  ...(process.platform === "win32"
    ? [
        {
          label: "Stage 6 bounded performance",
          command: node,
          args: [
            path.join(root, "scripts/stage6-performance.mjs"),
            "--core",
            "--ci",
            "--hardware",
            "minimum-supported",
          ],
          cwd: root,
        },
      ]
    : []),
  ...testSteps,
  {
    label: "build",
    command: node,
    args: [path.join(root, "scripts", "build.mjs")],
    cwd: root,
  },
]

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

let reportDirectory
let reports = []
try {
  reportDirectory = mkdtempSync(path.join(tmpdir(), "flapstack-test-inventory-"))
  reports = testSteps.map((step, index) => {
    const report = path.join(reportDirectory, `${index}.json`)
    step.args.push("--reporter=default", "--reporter=json", `--outputFile.json=${report}`)
    return report
  })
} catch (error) {
  console.warn("[tests] Could not set up Vitest inventory reporting:", error.message)
}

try {
  runWithIsolatedTestGitEnvironment((isolatedGitEnv) =>
    runCommandSequence(commandSteps, { env: isolatedGitEnv }),
  )
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
} finally {
  try {
    reportTestInventory(root, reports)
  } catch (error) {
    console.warn("[tests] Could not report the inventory:", error.message)
  }
  if (reportDirectory) {
    try {
      for (const report of reports) rmSync(report, { force: true })
      rmdirSync(reportDirectory)
    } catch (error) {
      console.warn("[tests] Could not remove temporary inventory reports:", error.message)
    }
  }
}
