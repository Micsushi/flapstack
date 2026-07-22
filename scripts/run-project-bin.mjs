#!/usr/bin/env node

import path from "node:path"
import { fileURLToPath } from "node:url"
import { packageBinStep, runCommandSequence } from "./lib/project-command.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const [packageName, binName, separator, ...args] = process.argv.slice(2)

if (!packageName || !binName || separator !== "--") {
  console.error("Usage: node scripts/run-project-bin.mjs <package> <bin> -- [arguments...]")
  process.exit(2)
}

try {
  runCommandSequence([packageBinStep(binName, packageName, binName, args, { root })], { root })
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
