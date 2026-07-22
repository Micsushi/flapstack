#!/usr/bin/env node

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { runCommandSequence } from "./lib/project-command.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const release = path.join(root, "release")
if (path.dirname(release) !== root) throw new Error("Refusing to clean release outside repository")
fs.rmSync(release, { recursive: true, force: true })

const npmCli = process.env.npm_execpath
if (!npmCli) throw new Error("npm_execpath is required for local release orchestration")

try {
  runCommandSequence(
    ["build", "package:mac", "package:inspect:mac"].map((name) => ({
      label: name,
      command: process.execPath,
      args: [npmCli, "run", name],
      cwd: root,
    })),
  )
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
