#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
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

export function resolveSttBuildEnv(targetKey, env = process.env) {
  if (targetKey !== "linux-arm64") return {}
  const portableCpu = "-DGGML_NATIVE=OFF"
  const buildEnv = {
    TRANSCRIBE_CMAKE_ARGS: [env.TRANSCRIBE_CMAKE_ARGS?.trim(), portableCpu]
      .filter(Boolean)
      .join(" "),
  }
  if (env.CMAKE_ARGS?.trim()) buildEnv.CMAKE_ARGS = `${env.CMAKE_ARGS.trim()} ${portableCpu}`
  return buildEnv
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

export function resolveTranscribeLicense(cargo, runner = spawnSync) {
  const result = runner(
    cargo.command,
    ["metadata", "--format-version=1", "--locked", "--offline"],
    {
      cwd: crate,
      encoding: "utf8",
      env: { ...process.env, ...cargo.env },
      maxBuffer: 16 * 1024 * 1024,
    },
  )
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error("Could not inspect the locked STT dependency graph")
  const metadata = JSON.parse(result.stdout)
  const dependency = metadata.packages?.find(
    (entry) => entry.name === "transcribe-cpp" && entry.version === TRANSCRIBE_CPP_VERSION,
  )
  if (!dependency?.manifest_path) {
    throw new Error(`Locked transcribe-cpp ${TRANSCRIBE_CPP_VERSION} metadata is missing`)
  }
  const license = path.join(path.dirname(dependency.manifest_path), "LICENSE")
  const stat = fs.lstatSync(license)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`transcribe-cpp license must be a regular file: ${license}`)
  }
  return license
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
    env: { ...process.env, ...cargo.env, ...resolveSttBuildEnv(targetKey) },
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`STT sidecar build failed for ${targetKey}`)
  const binaryName = targetKey.startsWith("win32-")
    ? "flapstack-stt-sidecar.exe"
    : "flapstack-stt-sidecar"
  return {
    binary:
      targetKey === hostKey
        ? path.join(crate, "target", "release", binaryName)
        : path.join(crate, "target", target, "release", binaryName),
    cargo,
  }
}

function main() {
  const targetKey = argsValue("--platform") || `${process.platform}-${process.arch}`
  const outputRoot = argsValue("--output-root")
  const { binary, cargo } = build(targetKey)
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
      resolveTranscribeLicense(cargo),
      path.join(destination, "transcribe.cpp-LICENSE"),
    )
    const digest = createHash("sha256").update(fs.readFileSync(binary)).digest("hex")
    fs.writeFileSync(path.join(destination, ".stt-sidecar.sha256"), `${digest}\n`)
    fs.writeFileSync(path.join(destination, ".transcribe-version"), `${TRANSCRIBE_CPP_VERSION}\n`)
  }

  console.log(`Prepared streaming STT sidecar for ${targetKey}`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
