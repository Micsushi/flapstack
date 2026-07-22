#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

export const TRANSCRIBE_CPP_VERSION = "0.1.3"
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const crate = path.join(root, "native", "stt-sidecar")

const rustTargets = {
  "darwin-arm64": "aarch64-apple-darwin",
  "darwin-x64": "x86_64-apple-darwin",
  "linux-arm64": "aarch64-unknown-linux-gnu",
  "linux-x64": "x86_64-unknown-linux-gnu",
  "win32-x64": "x86_64-pc-windows-msvc",
}

export function stableRustToolchainName(platform, arch) {
  const hostKey = `${platform}-${arch}`
  const target = rustTargets[hostKey]
  if (!target) throw new Error(`Unsupported Rust host: ${hostKey}`)
  return `stable-${target}`
}

function argsValue(name) {
  const inline = process.argv.find((value) => value.startsWith(`${name}=`))
  if (inline) return inline.slice(name.length + 1)
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : null
}

function cargoCommand() {
  const direct = spawnSync("cargo", ["--version"], { stdio: "ignore" })
  if (!direct.error && direct.status === 0) return { command: "cargo", env: {} }
  const home = process.env.RUSTUP_HOME || path.join(os.homedir(), ".rustup")
  const stable = path.join(
    home,
    "toolchains",
    stableRustToolchainName(process.platform, process.arch),
    "bin",
  )
  const cargo = path.join(stable, "cargo")
  const rustc = path.join(stable, "rustc")
  if (fs.existsSync(cargo) && fs.existsSync(rustc))
    return {
      command: cargo,
      env: { RUSTC: rustc, PATH: `${stable}${path.delimiter}${process.env.PATH}` },
    }
  throw new Error("Rust/Cargo is required to prepare the streaming STT sidecar")
}

function build(targetKey) {
  const cargo = cargoCommand()
  const target = rustTargets[targetKey]
  if (!target) throw new Error(`Unsupported STT sidecar target: ${targetKey}`)
  const hostKey = `${process.platform}-${process.arch}`
  const args = ["build", "--release"]
  if (targetKey !== hostKey) {
    const rustup = spawnSync("rustup", ["target", "add", target], { stdio: "inherit" })
    if (rustup.error || rustup.status !== 0)
      throw new Error(`Rust target ${target} is required to build ${targetKey}`)
    args.push("--target", target)
  }
  const result = spawnSync(cargo.command, args, {
    cwd: crate,
    stdio: "inherit",
    env: { ...process.env, ...cargo.env },
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`STT sidecar build failed for ${targetKey}`)
  const binaryName = targetKey.startsWith("win32-")
    ? "flapstack-stt-sidecar.exe"
    : "flapstack-stt-sidecar"
  return targetKey === hostKey
    ? path.join(crate, "target", "release", binaryName)
    : path.join(crate, "target", target, "release", binaryName)
}

function main() {
  const targetKey = argsValue("--platform") || `${process.platform}-${process.arch}`
  const outputRoot = argsValue("--output-root")
  const binary = build(targetKey)
  if (!fs.existsSync(binary)) throw new Error(`STT sidecar binary missing: ${binary}`)

  if (outputRoot) {
    const destination = path.join(outputRoot, targetKey)
    fs.mkdirSync(destination, { recursive: true })
    fs.copyFileSync(binary, path.join(destination, path.basename(binary)))
    fs.chmodSync(path.join(destination, path.basename(binary)), 0o755)
    fs.copyFileSync(
      path.join(crate, "LICENSE"),
      path.join(destination, "flapstack-stt-sidecar-LICENSE"),
    )
    fs.copyFileSync(
      path.join(
        os.homedir(),
        ".cargo",
        "registry",
        "src",
        fs.readdirSync(path.join(os.homedir(), ".cargo", "registry", "src"))[0],
        `transcribe-cpp-${TRANSCRIBE_CPP_VERSION}`,
        "LICENSE",
      ),
      path.join(destination, "transcribe.cpp-LICENSE"),
    )
    fs.writeFileSync(path.join(destination, ".transcribe-version"), `${TRANSCRIBE_CPP_VERSION}\n`)
  }

  console.log(`Prepared streaming STT sidecar for ${targetKey}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
