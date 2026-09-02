#!/usr/bin/env node

import path from "node:path"
import { fileURLToPath } from "node:url"
import { runCommandSequence } from "./lib/project-command.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const scripts = path.join(root, "scripts")
const steps = [
  {
    label: "node-pty macOS descriptor patch",
    command: process.execPath,
    args: [path.join(scripts, "patch-node-pty-macos.mjs")],
    cwd: root,
  },
]

if (!process.env.VERCEL) {
  steps.push(
    {
      label: "Electron install",
      command: process.execPath,
      args: [path.join(root, "node_modules", "electron", "install.js")],
      cwd: root,
    },
    {
      label: "Electron native ABI",
      command: process.execPath,
      args: [path.join(scripts, "ensure-native-abi.mjs"), "electron"],
      cwd: root,
    },
  )
}

steps.push(
  {
    label: "Electron development patch",
    command: process.execPath,
    args: [path.join(scripts, "patch-electron-dev.mjs")],
    cwd: root,
  },
  {
    label: "ACP provider patch",
    command: process.execPath,
    args: [path.join(scripts, "patch-acp-ai-provider.mjs")],
    cwd: root,
  },
)

try {
  runCommandSequence(steps)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
