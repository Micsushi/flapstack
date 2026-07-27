#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

function versionParts(value) {
  const match = String(value ?? "").match(/(\d+)\.(\d+)(?:\.(\d+))?/)
  return match ? [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)] : null
}

function requireVersion(errors, tools, key, label, predicate, expected) {
  const value = tools[key]
  const parts = versionParts(value)
  if (!value) errors.push(`${label} is required; not detected`)
  else if (!parts || !predicate(parts)) errors.push(`${expected}; found ${value}`)
}

export function evaluateWindowsToolchain(input) {
  const errors = []
  const tools = input.tools ?? {}
  if (input.platform !== "win32")
    errors.push(`Stage 5 requires a native Windows host; found ${input.platform}`)
  if (input.arch !== "x64") errors.push(`Stage 5 requires Windows x64; found ${input.arch}`)
  const windowsRelease = versionParts(input.osRelease)
  const isExplicitServer2022BuildHost =
    input.allowWindowsServer2022BuildHost === true &&
    windowsRelease?.[0] === 10 &&
    windowsRelease[1] === 0 &&
    windowsRelease[2] === 20348
  if (
    input.platform === "win32" &&
    !isExplicitServer2022BuildHost &&
    (!windowsRelease ||
      windowsRelease[0] !== 10 ||
      windowsRelease[1] !== 0 ||
      windowsRelease[2] < 22000)
  ) {
    errors.push(`Windows 11 x64 is required; found release ${input.osRelease ?? "missing"}`)
  }

  const node = versionParts(input.node)
  if (!node || node[0] !== 22) errors.push(`Node 22 is required; found ${input.node ?? "missing"}`)
  requireVersion(errors, tools, "npm", "npm", ([major]) => major === 10, "npm 10 is required")
  requireVersion(
    errors,
    tools,
    "python",
    "Python 3.11",
    ([major, minor]) => major === 3 && minor === 11,
    "Python 3.11 is required",
  )
  requireVersion(errors, tools, "cmake", "CMake", ([major]) => major >= 3, "CMake 3.x is required")
  requireVersion(errors, tools, "cargo", "Cargo", ([major]) => major >= 1, "Cargo is required")
  requireVersion(errors, tools, "rustc", "Rust", ([major]) => major >= 1, "Rust is required")
  requireVersion(
    errors,
    tools,
    "msbuild",
    "Visual Studio 2022 Build Tools",
    ([major]) => major === 17,
    "Visual Studio 2022 Build Tools (MSBuild 17) is required",
  )
  if (tools.spectreLibraries !== true) {
    errors.push(
      "Visual Studio 2022 C++ x64/x86 Spectre-mitigated libraries are required for node-pty",
    )
  }
  requireVersion(
    errors,
    tools,
    "windowsSdk",
    "Windows SDK",
    ([major]) => major >= 10,
    "Windows SDK 10 or newer is required",
  )
  requireVersion(errors, tools, "git", "Git", ([major]) => major >= 2, "Git 2.x is required")
  requireVersion(
    errors,
    tools,
    "powershell",
    "PowerShell",
    ([major, minor]) => major > 5 || (major === 5 && minor >= 1),
    "PowerShell 5.1 or newer is required",
  )
  return { ok: errors.length === 0, errors, tools }
}

export function redactDiagnosticPath(value, options = {}) {
  const home = path.win32.resolve(options.home ?? os.homedir())
  const normalizedValue = String(value ?? "")
  if (!normalizedValue) return normalizedValue
  const lowerValue = normalizedValue.toLowerCase()
  const lowerHome = home.toLowerCase()
  return lowerValue.startsWith(lowerHome)
    ? `<HOME>${normalizedValue.slice(home.length)}`
    : normalizedValue
}

function commandVersion(command, args = ["--version"], options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    windowsHide: true,
    ...options,
  })
  if (result.error || result.status !== 0) return null
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim()
}

function npmVersion() {
  const userAgent = process.env.npm_config_user_agent?.match(/npm\/([^\s]+)/)?.[1]
  if (userAgent) return userAgent
  const npmCli = process.env.npm_execpath
  if (npmCli && fs.existsSync(npmCli))
    return commandVersion(process.execPath, [npmCli, "--version"])
  const adjacent = path.join(
    path.dirname(process.execPath),
    "node_modules",
    "npm",
    "bin",
    "npm-cli.js",
  )
  return fs.existsSync(adjacent) ? commandVersion(process.execPath, [adjacent, "--version"]) : null
}

function pythonVersion() {
  return (
    commandVersion("py.exe", ["-3.11", "--version"]) ?? commandVersion("python.exe", ["--version"])
  )
}

function msbuildVersion() {
  const programFilesX86 = process.env["ProgramFiles(x86)"]
  const vswhere = programFilesX86
    ? path.join(programFilesX86, "Microsoft Visual Studio", "Installer", "vswhere.exe")
    : null
  if (!vswhere || !fs.existsSync(vswhere)) return null
  const result = spawnSync(
    vswhere,
    [
      "-latest",
      "-products",
      "*",
      "-requires",
      "Microsoft.Component.MSBuild",
      "-find",
      "MSBuild\\**\\Bin\\MSBuild.exe",
    ],
    { encoding: "utf8", windowsHide: true },
  )
  const executable = String(result.stdout ?? "")
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find(Boolean)
  return executable ? commandVersion(executable, ["-version", "-nologo"]) : null
}

function visualStudioComponentInstalled(componentId) {
  const programFilesX86 = process.env["ProgramFiles(x86)"]
  const vswhere = programFilesX86
    ? path.join(programFilesX86, "Microsoft Visual Studio", "Installer", "vswhere.exe")
    : null
  if (!vswhere || !fs.existsSync(vswhere)) return false
  const result = spawnSync(
    vswhere,
    ["-latest", "-products", "*", "-requires", componentId, "-property", "installationPath"],
    { encoding: "utf8", windowsHide: true },
  )
  return result.status === 0 && String(result.stdout ?? "").trim().length > 0
}

function windowsSdkVersion() {
  const environmentVersion = process.env.WindowsSDKVersion?.replace(/[\\/]+$/, "")
  if (environmentVersion) return environmentVersion
  const programFilesX86 = process.env["ProgramFiles(x86)"]
  const includeRoot = programFilesX86
    ? path.join(programFilesX86, "Windows Kits", "10", "Include")
    : null
  if (!includeRoot || !fs.existsSync(includeRoot)) return null
  return fs
    .readdirSync(includeRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && versionParts(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
    .at(-1)
}

export function detectWindowsToolchain() {
  return {
    npm: npmVersion(),
    python: pythonVersion(),
    cmake: commandVersion("cmake.exe"),
    cargo: commandVersion("cargo.exe"),
    rustc: commandVersion("rustc.exe"),
    msbuild: msbuildVersion(),
    spectreLibraries: visualStudioComponentInstalled(
      "Microsoft.VisualStudio.Component.VC.Runtimes.x86.x64.Spectre",
    ),
    windowsSdk: windowsSdkVersion(),
    git: commandVersion("git.exe"),
    powershell:
      commandVersion("pwsh.exe", [
        "-NoLogo",
        "-NoProfile",
        "-Command",
        "$PSVersionTable.PSVersion.ToString()",
      ]) ??
      commandVersion("powershell.exe", [
        "-NoLogo",
        "-NoProfile",
        "-Command",
        "$PSVersionTable.PSVersion.ToString()",
      ]),
  }
}

function main() {
  if (process.argv.includes("--if-windows") && process.platform !== "win32") {
    console.log("Windows prerequisite check skipped on non-Windows host.")
    return
  }
  const tools = detectWindowsToolchain()
  const result = evaluateWindowsToolchain({
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
    allowWindowsServer2022BuildHost:
      process.env.CI === "true" && process.env.GITHUB_ACTIONS === "true",
    node: process.versions.node,
    tools,
  })
  console.log("Windows Stage 5 prerequisite report")
  console.log(`Repository: ${redactDiagnosticPath(root)}`)
  console.log(`Host: ${process.platform}-${process.arch}`)
  console.log(`Node: ${process.versions.node}`)
  for (const [name, value] of Object.entries(tools)) console.log(`${name}: ${value ?? "missing"}`)
  if (!result.ok) {
    console.error("\nPrerequisite failures:")
    for (const error of result.errors) console.error(`- ${error}`)
    process.exit(1)
  }
  console.log("\nWindows prerequisites: PASS")
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
