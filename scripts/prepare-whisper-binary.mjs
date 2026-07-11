#!/usr/bin/env node

import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import {
  assertAllowlistedRegularFiles,
  assertBundledBinary,
  ensureRealDirectory,
  replaceDirectoryAtomically,
} from "./lib/packaged-binary.mjs"

const VERSION = "1.8.6"
const RECIPE_VERSION = `${VERSION}-portable-v1`
const SOURCE_SHA256 = "f8e632016ceae556f3132a16c7f704be1e7715595041f474fa81a2b64c1abf7c"
const WINDOWS_X64_SHA256 = "b07ea0b1b4115a38e1a7b07debf581f0b77d999925f8acb8f39d322b0ba0a822"
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

function outputRoot(args = process.argv.slice(2)) {
  const argument = args.find((value) => value.startsWith("--output-root="))
  return argument
    ? path.resolve(argument.slice("--output-root=".length))
    : path.join(root, "resources", "bin")
}

export function whisperResourceFiles(platformKey) {
  return platformKey === "win32-x64"
    ? [
        ".whisper-version",
        "ggml-base.dll",
        "ggml-cpu.dll",
        "ggml.dll",
        "whisper-cli.exe",
        "whisper.cpp-LICENSE",
        "whisper.dll",
      ]
    : [".whisper-version", "whisper-cli", "whisper.cpp-LICENSE"]
}

export function validateWhisperDirectory(directory, platformKey) {
  const files = whisperResourceFiles(platformKey)
  assertAllowlistedRegularFiles(directory, files)
  const marker = path.join(directory, ".whisper-version")
  if (fs.readFileSync(marker, "utf8").trim() !== RECIPE_VERSION) {
    throw new Error(`${marker}: expected ${RECIPE_VERSION}`)
  }
  assertBundledBinary(
    path.join(directory, platformKey === "win32-x64" ? "whisper-cli.exe" : "whisper-cli"),
    platformKey,
  )
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options })
  if (result.error?.code === "ENOENT") {
    throw new Error(
      `Missing packaging prerequisite: ${command}. Install it and ensure it is available on PATH.`,
      { cause: result.error },
    )
  }
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} failed with exit code ${result.status}`)
}

async function download(url, target, expectedSha256) {
  const response = await fetch(url, { redirect: "follow" })
  if (!response.ok) throw new Error(`Download failed: HTTP ${response.status} for ${url}`)
  fs.writeFileSync(target, Buffer.from(await response.arrayBuffer()))
  const digest = createHash("sha256").update(fs.readFileSync(target)).digest("hex")
  if (digest !== expectedSha256) {
    throw new Error(`Checksum mismatch for ${url}: expected ${expectedSha256}, got ${digest}`)
  }
}

function parsePlatforms(args = process.argv.slice(2)) {
  const values = args
    .filter((argument) => argument.startsWith("--platform="))
    .map((argument) => argument.slice("--platform=".length))
  return values.length ? values : [`${process.platform}-${process.arch}`]
}

function copyLicense(sourceRoot, outputDir) {
  const license = path.join(sourceRoot, "LICENSE")
  if (fs.existsSync(license)) fs.copyFileSync(license, path.join(outputDir, "whisper.cpp-LICENSE"))
}

async function prepareWindowsX64(outputDir, tempDir) {
  const archive = path.join(tempDir, "whisper-bin-x64.zip")
  await download(
    `https://github.com/ggml-org/whisper.cpp/releases/download/v${VERSION}/whisper-bin-x64.zip`,
    archive,
    WINDOWS_X64_SHA256,
  )
  const extracted = path.join(tempDir, "windows")
  fs.mkdirSync(extracted, { recursive: true })
  run("tar", ["-xf", archive, "-C", extracted])
  const release = path.join(extracted, "Release")
  for (const name of [
    "whisper-cli.exe",
    "whisper.dll",
    "ggml.dll",
    "ggml-base.dll",
    "ggml-cpu.dll",
  ]) {
    fs.copyFileSync(path.join(release, name), path.join(outputDir, name))
  }
  const sourceArchive = path.join(tempDir, "whisper.cpp.tar.gz")
  await download(
    `https://github.com/ggml-org/whisper.cpp/archive/refs/tags/v${VERSION}.tar.gz`,
    sourceArchive,
    SOURCE_SHA256,
  )
  run("tar", ["-xzf", sourceArchive, "-C", tempDir])
  copyLicense(path.join(tempDir, `whisper.cpp-${VERSION}`), outputDir)
}

async function prepareSourceBuild(platformKey, outputDir, tempDir) {
  const archive = path.join(tempDir, "whisper.cpp.tar.gz")
  await download(
    `https://github.com/ggml-org/whisper.cpp/archive/refs/tags/v${VERSION}.tar.gz`,
    archive,
    SOURCE_SHA256,
  )
  run("tar", ["-xzf", archive, "-C", tempDir])
  const sourceRoot = path.join(tempDir, `whisper.cpp-${VERSION}`)
  const buildDir = path.join(tempDir, `build-${platformKey}`)
  const cmakeArgs = [
    "-S",
    sourceRoot,
    "-B",
    buildDir,
    "-DCMAKE_BUILD_TYPE=Release",
    "-DBUILD_SHARED_LIBS=OFF",
    "-DWHISPER_BUILD_TESTS=OFF",
    "-DWHISPER_BUILD_SERVER=OFF",
    "-DWHISPER_SDL2=OFF",
    "-DGGML_NATIVE=OFF",
  ]
  if (platformKey === "darwin-arm64") cmakeArgs.push("-DCMAKE_OSX_ARCHITECTURES=arm64")
  if (platformKey === "darwin-x64") cmakeArgs.push("-DCMAKE_OSX_ARCHITECTURES=x86_64")
  run("cmake", cmakeArgs)
  run("cmake", ["--build", buildDir, "--config", "Release", "--target", "whisper-cli", "-j"])
  const candidates = [
    path.join(buildDir, "bin", "whisper-cli"),
    path.join(buildDir, "bin", "Release", "whisper-cli"),
  ]
  const binary = candidates.find((candidate) => fs.existsSync(candidate))
  if (!binary) throw new Error(`whisper-cli was not produced for ${platformKey}`)
  fs.copyFileSync(binary, path.join(outputDir, "whisper-cli"))
  fs.chmodSync(path.join(outputDir, "whisper-cli"), 0o755)
  copyLicense(sourceRoot, outputDir)
}

async function prepare(platformKey) {
  const supported = /^(darwin|linux)-(arm64|x64)$/.test(platformKey) || platformKey === "win32-x64"
  if (!supported) throw new Error(`No pinned whisper.cpp packaging recipe for ${platformKey}`)
  const binRoot = outputRoot()
  const outputDir = path.join(binRoot, platformKey)
  try {
    validateWhisperDirectory(outputDir, platformKey)
    console.log(`whisper.cpp ${VERSION} already prepared for ${platformKey}`)
    return
  } catch {
    if (fs.existsSync(outputDir)) {
      console.log(`Existing whisper.cpp cache is non-regular or invalid; rebuilding ${platformKey}`)
    }
  }
  ensureRealDirectory(binRoot)
  const stagingDir = fs.mkdtempSync(path.join(binRoot, `.whisper-${platformKey}-`))
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `flapstack-whisper-${platformKey}-`))
  try {
    if (platformKey === "win32-x64") await prepareWindowsX64(stagingDir, tempDir)
    else await prepareSourceBuild(platformKey, stagingDir, tempDir)
    fs.writeFileSync(path.join(stagingDir, ".whisper-version"), `${RECIPE_VERSION}\n`)
    validateWhisperDirectory(stagingDir, platformKey)
    replaceDirectoryAtomically(stagingDir, outputDir)
    validateWhisperDirectory(outputDir, platformKey)
    console.log(`Prepared whisper.cpp ${VERSION} for ${platformKey}`)
  } finally {
    fs.rmSync(stagingDir, { recursive: true, force: true })
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

async function main() {
  for (const platform of parsePlatforms()) await prepare(platform)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
