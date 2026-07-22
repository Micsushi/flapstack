#!/usr/bin/env node

import path from "node:path"
import { fileURLToPath } from "node:url"
import { packageBinStep, runCommandSequence } from "./lib/project-command.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

try {
  runCommandSequence([
    packageBinStep("build", "electron-vite", "electron-vite", ["build"], {
      root,
      env: {
        NODE_OPTIONS: [process.env.NODE_OPTIONS, "--max-old-space-size=6144"]
          .filter(Boolean)
          .join(" "),
      },
    }),
  ])
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
