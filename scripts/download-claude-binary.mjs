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

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.join(__dirname, "..")
const outputRootArg = process.argv.find((argument) => argument.startsWith("--output-root="))
const BIN_DIR = outputRootArg
  ? path.resolve(outputRootArg.slice("--output-root=".length))
  : path.join(ROOT_DIR, "resources", "bin")

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
          return fetchJson(res.headers.location).then(resolve).catch(reject)
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}`))
        }
        let data = ""
        res.on("data", (chunk) => (data += chunk))
        res.on("end", () => resolve(JSON.parse(data)))
        res.on("error", reject)
      })
      .on("error", reject)
  })
}

/**
 * Download file with progress
 */
function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const request = (nextUrl) => {
      const file = fs.createWriteStream(destPath)
      https
        .get(nextUrl, (res) => {
          if (res.statusCode === 301 || res.statusCode === 302) {
            const redirectUrl = res.headers.location
            if (!redirectUrl) {
              file.close()
              fs.rmSync(destPath, { force: true })
              return reject(new Error("Missing redirect location"))
            }
            file.close(() => {
              fs.rmSync(destPath, { force: true })
              request(redirectUrl)
            })
            return
          }

          if (res.statusCode !== 200) {
            file.close()
            fs.rmSync(destPath, { force: true })
            return reject(new Error(`HTTP ${res.statusCode}`))
          }

          const totalSize = Number.parseInt(res.headers["content-length"] || "0", 10)
          let downloaded = 0
          let lastPercent = 0

          res.on("data", (chunk) => {
            downloaded += chunk.length
            if (totalSize <= 0) return
            const percent = Math.floor((downloaded / totalSize) * 100)
            if (percent !== lastPercent && percent % 10 === 0) {
              process.stdout.write(`\r  Progress: ${percent}%`)
              lastPercent = percent
            }
          })

          res.pipe(file)

          file.on("finish", () => {
            file.close()
            if (totalSize > 0) process.stdout.write("\r  Progress: 100%\n")
            resolve()
          })

          res.on("error", (err) => {
            file.close()
            fs.rmSync(destPath, { force: true })
            reject(err)
          })
        })
        .on("error", (err) => {
          file.close()
          fs.rmSync(destPath, { force: true })
          reject(err)
        })
    }

    request(url)
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
  return "2.1.45"
}

/**
 * Download binary for a specific platform
 */
async function downloadPlatform(version, platformKey, manifest) {
  const platform = PLATFORMS[platformKey]
  if (!platform) {
    console.error(`Unknown platform: ${platformKey}`)
    return false
  }

  const targetDir = path.join(BIN_DIR, platformKey)
  const targetPath = path.join(targetDir, platform.binary)

  // Create directory
  ensureRealDirectory(BIN_DIR)
  ensureRealDirectory(targetDir)

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
  await downloadFile(downloadUrl, downloadPath)

  // Verify hash
  const actualHash = await sha256File(downloadPath)
  if (actualHash !== expectedHash) {
    console.error(`  Hash mismatch!`)
    console.error(`    Expected: ${expectedHash}`)
    console.error(`    Actual:   ${actualHash}`)
    fs.rmSync(downloadPath, { force: true })
    return false
  }
  console.log(`  Verified SHA256: ${actualHash.substring(0, 16)}...`)

  // Make executable (Unix)
  fs.rmSync(targetPath, { recursive: true, force: true })
  fs.renameSync(downloadPath, targetPath)
  if (!platformKey.startsWith("win32")) {
    fs.chmodSync(targetPath, 0o755)
  }
  assertBundledBinary(targetPath, platformKey)

  console.log(`  Saved to: ${targetPath}`)
  return true
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
    manifest = await fetchJson(manifestUrl)
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

  // Write version file
  fs.writeFileSync(path.join(BIN_DIR, "VERSION"), `${version}\n${new Date().toISOString()}\n`)

  // Download each platform
  let success = true
  for (const platform of platformsToDownload) {
    const result = await downloadPlatform(version, platform, manifest)
    if (!result) success = false
  }

  if (success) {
    console.log("\n✓ All downloads completed successfully!")
  } else {
    console.error("\n✗ Some downloads failed")
    process.exit(1)
  }
}

main().catch((error) => {
  console.error("Fatal error:", error)
  process.exit(1)
})
