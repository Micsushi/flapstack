#!/usr/bin/env node
/**
 * Downloads Claude Code native binaries for bundling with the Electron app.
 *
 * Usage:
 *   node scripts/download-claude-binary.mjs                          # Download for current platform
 *   node scripts/download-claude-binary.mjs --all                    # Download all platforms
 *   node scripts/download-claude-binary.mjs --platform darwin-x64    # Download for specific platform
 *   node scripts/download-claude-binary.mjs --version=2.1.5          # Specific version
 */

import fs from "node:fs"
import path from "node:path"
import https from "node:https"
import { fileURLToPath } from "node:url"
import { assertBundledBinary, ensureRealDirectory, sha256File } from "./lib/packaged-binary.mjs"
import {
  downloadFileWithRetry,
  fetchJsonWithCache,
  metadataCachePath,
  recoverInterruptedFileReplacement,
  replaceFileAtomically,
} from "./lib/download-recovery.mjs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.join(__dirname, "..")
const outputRootArg = process.argv.find((argument) => argument.startsWith("--output-root="))
const BIN_DIR = outputRootArg
  ? path.resolve(outputRootArg.slice("--output-root=".length))
  : path.join(ROOT_DIR, "resources", "bin")
const metadataCacheRoot = process.env.FLAPSTACK_BINARY_METADATA_CACHE
  ? path.resolve(process.env.FLAPSTACK_BINARY_METADATA_CACHE)
  : path.join(ROOT_DIR, "resources", "bin", ".metadata")

// Claude Code distribution base URL
const DIST_BASE =
  "https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/claude-code-releases"

// Platform mappings
const PLATFORMS = {
  "darwin-arm64": { dir: "darwin-arm64", binary: "claude" },
  "darwin-x64": { dir: "darwin-x64", binary: "claude" },
  "linux-arm64": { dir: "linux-arm64", binary: "claude" },
  "linux-x64": { dir: "linux-x64", binary: "claude" },
  "win32-arm64": { dir: "win32-arm64", binary: "claude.exe" },
  "win32-x64": { dir: "win32-x64", binary: "claude.exe" },
}

/**
 * Fetch JSON from URL
 */
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          const redirectUrl = res.headers.location
          if (!redirectUrl) return reject(new Error("Missing redirect location"))
          return fetchJson(redirectUrl).then(resolve).catch(reject)
        }
        if (res.statusCode !== 200) {
          res.resume()
          return reject(new Error(`HTTP ${res.statusCode}`))
        }
        let data = ""
        res.on("data", (chunk) => (data += chunk))
        res.on("end", () => {
          try {
            resolve(JSON.parse(data))
          } catch (error) {
            reject(error)
          }
        })
        res.on("error", reject)
      })
      .on("error", reject)
  })
}

/**
 * Get latest version from GCS bucket
 */
async function getLatestVersion() {
  console.log("Fetching latest Claude Code version...")

  try {
    // Fetch from the same endpoint that install.sh uses
    const response = await fetch(
      "https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/claude-code-releases/latest",
    )
    if (response.ok) {
      const version = await response.text()
      return version.trim()
    }
  } catch (error) {
    console.warn(`Failed to fetch latest version: ${error.message}`)
  }

  // Fallback to known version (should be updated periodically)
  return "2.1.207"
}

/**
 * Download binary for a specific platform
 */
export async function downloadPlatform(version, platformKey, manifest, options = {}) {
  const platform = PLATFORMS[platformKey]
  if (!platform) {
    console.error(`Unknown platform: ${platformKey}`)
    return false
  }

  const binDirectory = options.binDirectory ?? BIN_DIR
  const targetDir = path.join(binDirectory, platformKey)
  const targetPath = path.join(targetDir, platform.binary)

  // Create directory
  ensureRealDirectory(binDirectory)
  ensureRealDirectory(targetDir)
  recoverInterruptedFileReplacement(targetPath)

  // Get expected hash from manifest
  const platformManifest = manifest.platforms[platform.dir]
  if (!platformManifest) {
    console.error(`No manifest entry for ${platform.dir}`)
    return false
  }

  const expectedHash = platformManifest.checksum
  const downloadUrl = `${DIST_BASE}/${version}/${platform.dir}/${platform.binary}`

  console.log(`\nDownloading Claude Code for ${platformKey}...`)
  console.log(`  URL: ${downloadUrl}`)
  console.log(`  Size: ${(platformManifest.size / 1024 / 1024).toFixed(1)} MB`)

  // Check if already downloaded with correct hash
  try {
    assertBundledBinary(targetPath, platformKey)
    const existingHash = await sha256File(targetPath)
    if (existingHash === expectedHash) {
      console.log(`  Already downloaded and verified`)
      return true
    }
    console.log(`  Existing file has wrong hash, re-downloading...`)
  } catch {
    if (fs.existsSync(targetPath)) {
      console.log(`  Existing Claude cache is non-regular or invalid, re-downloading...`)
    }
  }

  const downloadPath = `${targetPath}.download`
  fs.rmSync(downloadPath, { recursive: true, force: true })
  try {
    await (options.downloadFile ?? downloadFileWithRetry)(downloadUrl, downloadPath, {
      label: `Claude ${platformKey}`,
      onRetry: ({ attempt, attempts, error }) =>
        console.warn(`  ${error.message}; retrying Claude download (${attempt}/${attempts})...`),
    })

    const actualHash = await sha256File(downloadPath)
    if (actualHash !== expectedHash) {
      console.error(`  Hash mismatch!`)
      console.error(`    Expected: ${expectedHash}`)
      console.error(`    Actual:   ${actualHash}`)
      return false
    }
    console.log(`  Verified SHA256: ${actualHash.substring(0, 16)}...`)

    if (!platformKey.startsWith("win32")) fs.chmodSync(downloadPath, 0o755)
    assertBundledBinary(downloadPath, platformKey)
    replaceFileAtomically(downloadPath, targetPath)

    console.log(`  Saved to: ${targetPath}`)
    return true
  } finally {
    fs.rmSync(downloadPath, { recursive: true, force: true })
  }
}

/**
 * Main entry point
 */
async function main() {
  const args = process.argv.slice(2)
  const downloadAll = args.includes("--all")
  const versionArg = args.find((a) => a.startsWith("--version="))
  const specifiedVersion = versionArg?.split("=")[1]
  const specifiedPlatforms = []
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument.startsWith("--platform=")) specifiedPlatforms.push(argument.split("=")[1])
    else if (argument === "--platform" && args[index + 1]) specifiedPlatforms.push(args[++index])
  }

  console.log("Claude Code Binary Downloader")
  console.log("=============================\n")

  // Get version
  const version = specifiedVersion || (await getLatestVersion())
  console.log(`Version: ${version}`)

  // Fetch manifest
  const manifestUrl = `${DIST_BASE}/${version}/manifest.json`
  console.log(`Fetching manifest: ${manifestUrl}`)

  let manifest
  try {
    manifest = await fetchJsonWithCache(
      manifestUrl,
      metadataCachePath(metadataCacheRoot, "claude", version),
      fetchJson,
      {
        label: `Claude ${version} manifest`,
        onCacheFallback: (error) =>
          console.warn(`Using cached Claude manifest after network failure: ${error.message}`),
      },
    )
  } catch (error) {
    console.error(`Failed to fetch manifest: ${error.message}`)
    process.exit(1)
  }

  // Determine which platforms to download
  let platformsToDownload
  if (downloadAll) {
    platformsToDownload = Object.keys(PLATFORMS)
  } else if (specifiedPlatforms.length > 0) {
    // Specific platform requested via --platform
    const unsupportedPlatform = specifiedPlatforms.find((platform) => !PLATFORMS[platform])
    if (unsupportedPlatform) {
      console.error(`Unsupported platform: ${unsupportedPlatform}`)
      console.log(`Supported platforms: ${Object.keys(PLATFORMS).join(", ")}`)
      process.exit(1)
    }
    platformsToDownload = [...new Set(specifiedPlatforms)]
  } else {
    // Current platform only
    const currentPlatform = `${process.platform}-${process.arch}`
    if (!PLATFORMS[currentPlatform]) {
      console.error(`Unsupported platform: ${currentPlatform}`)
      console.log(`Supported platforms: ${Object.keys(PLATFORMS).join(", ")}`)
      process.exit(1)
    }
    platformsToDownload = [currentPlatform]
  }

  console.log(`\nPlatforms to download: ${platformsToDownload.join(", ")}`)

  // Create bin directory
  ensureRealDirectory(BIN_DIR)

  // Download each platform
  let success = true
  for (const platform of platformsToDownload) {
    const result = await downloadPlatform(version, platform, manifest)
    if (!result) success = false
  }

  if (success) {
    fs.writeFileSync(path.join(BIN_DIR, "VERSION"), `${version}\n${new Date().toISOString()}\n`)
    console.log("\n✓ All downloads completed successfully!")
  } else {
    console.error("\n✗ Some downloads failed")
    process.exit(1)
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error("Fatal error:", error)
    process.exit(1)
  })
}
