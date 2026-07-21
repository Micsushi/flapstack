#!/usr/bin/env node
/**
 * Downloads Codex CLI native binaries for bundling with the Electron app.
 *
 * Usage:
 *   node scripts/download-codex-binary.mjs              # Download for current platform
 *   node scripts/download-codex-binary.mjs --all        # Download all platforms
 *   node scripts/download-codex-binary.mjs --version=0.144.1
 */

import fs from "node:fs"
import path from "node:path"
import https from "node:https"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import {
  assertBundledBinary,
  ensureRealDirectory,
  sha256File,
  verifyCachedBinaryDigest,
} from "./lib/packaged-binary.mjs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.join(__dirname, "..")
const outputRootArg = process.argv.find((argument) => argument.startsWith("--output-root="))
const BIN_DIR = outputRootArg
  ? path.resolve(outputRootArg.slice("--output-root=".length))
  : path.join(ROOT_DIR, "resources", "bin")

const RELEASE_REPO = "openai/codex"
const RELEASE_TAG_PREFIX = "rust-v"
const USER_AGENT = "flapstack-desktop-codex-downloader"
const MAX_DOWNLOAD_ATTEMPTS = 3
const RETRYABLE_DOWNLOAD_STATUSES = new Set([403, 408, 429, 500, 502, 503, 504])

const PLATFORMS = {
  "darwin-arm64": {
    assetName: "codex-aarch64-apple-darwin.tar.gz",
    extractedBinaryName: "codex-aarch64-apple-darwin",
    outputBinaryName: "codex",
  },
  "darwin-x64": {
    assetName: "codex-x86_64-apple-darwin.tar.gz",
    extractedBinaryName: "codex-x86_64-apple-darwin",
    outputBinaryName: "codex",
  },
  "linux-arm64": {
    assetName: "codex-aarch64-unknown-linux-musl.tar.gz",
    extractedBinaryName: "codex-aarch64-unknown-linux-musl",
    outputBinaryName: "codex",
  },
  "linux-x64": {
    assetName: "codex-x86_64-unknown-linux-musl.tar.gz",
    extractedBinaryName: "codex-x86_64-unknown-linux-musl",
    outputBinaryName: "codex",
  },
  "win32-arm64": {
    assetName: "codex-aarch64-pc-windows-msvc.exe",
    outputBinaryName: "codex.exe",
  },
  "win32-x64": {
    assetName: "codex-x86_64-pc-windows-msvc.exe",
    outputBinaryName: "codex.exe",
  },
}

function getRequestHeaders({ api = false } = {}) {
  const headers = {
    "User-Agent": USER_AGENT,
    Accept: api ? "application/vnd.github+json" : "application/octet-stream",
  }
  // Authenticate API metadata requests without forwarding repository
  // credentials to signed release-asset redirects on another host.
  const token = process.env.GITHUB_TOKEN
  if (api && token) {
    headers.Authorization = `Bearer ${token}`
  }
  return headers
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: getRequestHeaders({ api: true }) }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          const redirectUrl = res.headers.location
          if (!redirectUrl) {
            return reject(new Error("Missing redirect location"))
          }
          return fetchJson(redirectUrl).then(resolve).catch(reject)
        }

        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}`))
        }

        let data = ""
        res.on("data", (chunk) => {
          data += chunk
        })
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

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const request = (nextUrl, attempt = 1) => {
      const file = fs.createWriteStream(destPath)

      https
        .get(nextUrl, { headers: getRequestHeaders() }, (res) => {
          if (res.statusCode === 301 || res.statusCode === 302) {
            const redirectUrl = res.headers.location
            if (!redirectUrl) {
              file.close()
              fs.rmSync(destPath, { force: true })
              return reject(new Error("Missing redirect location"))
            }

            file.close(() => {
              fs.rmSync(destPath, { force: true })
              request(redirectUrl, attempt)
            })
            return
          }

          if (res.statusCode !== 200) {
            const status = res.statusCode ?? 0
            res.resume()
            file.close(() => {
              fs.rmSync(destPath, { force: true })
              if (RETRYABLE_DOWNLOAD_STATUSES.has(status) && attempt < MAX_DOWNLOAD_ATTEMPTS) {
                const delayMs = 1000 * 2 ** (attempt - 1)
                console.warn(
                  `  HTTP ${status}; retrying Codex download (${attempt + 1}/${MAX_DOWNLOAD_ATTEMPTS})...`,
                )
                setTimeout(() => request(url, attempt + 1), delayMs)
                return
              }
              reject(new Error(`HTTP ${status}`))
            })
            return
          }

          const totalSize = Number.parseInt(res.headers["content-length"] || "0", 10)
          let downloaded = 0
          let lastPrintedPercent = -1

          res.on("data", (chunk) => {
            downloaded += chunk.length
            if (totalSize <= 0) return

            const percent = Math.floor((downloaded / totalSize) * 100)
            if (percent !== lastPrintedPercent && percent % 10 === 0) {
              process.stdout.write(`\r  Progress: ${percent}%`)
              lastPrintedPercent = percent
            }
          })

          res.pipe(file)

          file.on("finish", () => {
            file.close()
            if (totalSize > 0) {
              process.stdout.write("\r  Progress: 100%\n")
            }
            resolve()
          })

          res.on("error", (error) => {
            file.close()
            fs.rmSync(destPath, { force: true })
            reject(error)
          })
        })
        .on("error", (error) => {
          file.close()
          fs.rmSync(destPath, { force: true })
          reject(error)
        })
    }

    request(url)
  })
}

function parseSha256Digest(rawDigest) {
  if (typeof rawDigest !== "string") return null
  if (!rawDigest.startsWith("sha256:")) return null

  const value = rawDigest.slice("sha256:".length).trim().toLowerCase()
  return value.length > 0 ? value : null
}

function extractTarGz(archivePath, targetDir) {
  const result = spawnSync("tar", ["-xzf", archivePath, "-C", targetDir], {
    stdio: "inherit",
  })

  if (result.status !== 0) {
    throw new Error(`tar extraction failed with code ${result.status ?? "unknown"}`)
  }
}

function getVersionArg(args) {
  const equalsArg = args.find((arg) => arg.startsWith("--version="))
  if (equalsArg) {
    return equalsArg.slice("--version=".length)
  }

  const index = args.indexOf("--version")
  if (index >= 0 && args[index + 1]) {
    return args[index + 1]
  }

  return null
}

async function getLatestVersion() {
  const release = await fetchJson(`https://api.github.com/repos/${RELEASE_REPO}/releases/latest`)

  const tagName = typeof release?.tag_name === "string" ? release.tag_name : ""
  if (tagName.startsWith(RELEASE_TAG_PREFIX)) {
    return tagName.slice(RELEASE_TAG_PREFIX.length)
  }

  throw new Error(`Unexpected latest release tag: ${tagName || "<empty>"}`)
}

async function fetchRelease(version) {
  return await fetchJson(
    `https://api.github.com/repos/${RELEASE_REPO}/releases/tags/${RELEASE_TAG_PREFIX}${version}`,
  )
}

function findAsset(release, assetName) {
  const assets = Array.isArray(release?.assets) ? release.assets : []
  return assets.find((asset) => asset?.name === assetName)
}

async function downloadPlatform(version, platformKey, release) {
  const platform = PLATFORMS[platformKey]
  if (!platform) {
    console.error(`Unknown platform: ${platformKey}`)
    return false
  }

  const targetDir = path.join(BIN_DIR, platformKey)
  const targetPath = path.join(targetDir, platform.outputBinaryName)
  const assetHashMarkerPath = path.join(targetDir, ".codex-asset.sha256")
  const binaryHashMarkerPath = path.join(targetDir, ".codex-binary.sha256")

  ensureRealDirectory(BIN_DIR)
  ensureRealDirectory(targetDir)

  const asset = findAsset(release, platform.assetName)
  if (!asset) {
    console.error(`Missing release asset ${platform.assetName}`)
    return false
  }

  const expectedHash = parseSha256Digest(asset.digest)
  const downloadUrl = asset.browser_download_url

  if (!expectedHash) {
    console.error(`Missing SHA256 digest for pinned Codex asset ${platform.assetName}`)
    return false
  }

  if (!downloadUrl) {
    console.error(`Missing download URL for ${platform.assetName}`)
    return false
  }

  console.log(`\nDownloading Codex for ${platformKey}...`)
  console.log(`  URL: ${downloadUrl}`)
  console.log(`  Size: ${(asset.size / 1024 / 1024).toFixed(1)} MB`)

  try {
    const assetMarker = fs.readFileSync(assetHashMarkerPath, "utf8").trim()
    if (
      assetMarker === expectedHash &&
      (await verifyCachedBinaryDigest(targetPath, platformKey, binaryHashMarkerPath))
    ) {
      console.log("  Already downloaded and verified")
      return true
    }
    console.log("  Existing Codex cache failed digest validation, re-downloading...")
  } catch {
    if (fs.existsSync(targetPath)) {
      console.log("  Existing Codex cache is missing, non-regular, or invalid; re-downloading...")
    }
  }

  const downloadPath = path.join(targetDir, `${platform.assetName}.download`)
  fs.rmSync(downloadPath, { force: true })

  await downloadFile(downloadUrl, downloadPath)

  if (expectedHash) {
    const actualHash = await sha256File(downloadPath)
    if (actualHash !== expectedHash) {
      console.error("  Hash mismatch!")
      console.error(`    Expected: ${expectedHash}`)
      console.error(`    Actual:   ${actualHash}`)
      fs.rmSync(downloadPath, { force: true })
      return false
    }
    console.log(`  Verified SHA256: ${actualHash.slice(0, 16)}...`)
  }

  if (platform.assetName.endsWith(".tar.gz")) {
    const extractDir = path.join(targetDir, ".extract")
    fs.rmSync(extractDir, { recursive: true, force: true })
    fs.mkdirSync(extractDir, { recursive: true })

    extractTarGz(downloadPath, extractDir)

    const extractedPath = path.join(extractDir, platform.extractedBinaryName)
    if (!fs.existsSync(extractedPath)) {
      fs.rmSync(downloadPath, { force: true })
      fs.rmSync(extractDir, { recursive: true, force: true })
      throw new Error(`Extracted binary not found: ${extractedPath}`)
    }

    fs.rmSync(targetPath, { recursive: true, force: true })
    fs.copyFileSync(extractedPath, targetPath)
    fs.rmSync(extractDir, { recursive: true, force: true })
  } else {
    fs.rmSync(targetPath, { recursive: true, force: true })
    fs.copyFileSync(downloadPath, targetPath)
  }

  fs.rmSync(downloadPath, { force: true })

  if (!platformKey.startsWith("win32")) {
    fs.chmodSync(targetPath, 0o755)
  }

  assertBundledBinary(targetPath, platformKey)
  const binaryHash = await sha256File(targetPath)
  fs.writeFileSync(assetHashMarkerPath, `${expectedHash}\n`)
  fs.writeFileSync(binaryHashMarkerPath, `${binaryHash}\n`)

  console.log(`  Saved to: ${targetPath}`)
  return true
}

async function main() {
  const args = process.argv.slice(2)
  const downloadAll = args.includes("--all")
  const specifiedVersion = getVersionArg(args)
  const specifiedPlatforms = []
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument.startsWith("--platform=")) specifiedPlatforms.push(argument.split("=")[1])
    else if (argument === "--platform" && args[index + 1]) specifiedPlatforms.push(args[++index])
  }

  console.log("Codex Binary Downloader")
  console.log("=======================\n")

  const version = specifiedVersion || (await getLatestVersion())
  console.log(`Version: ${version}`)

  const release = await fetchRelease(version)

  let platformsToDownload
  if (downloadAll) {
    platformsToDownload = Object.keys(PLATFORMS)
  } else if (specifiedPlatforms.length > 0) {
    const unsupportedPlatform = specifiedPlatforms.find((platform) => !PLATFORMS[platform])
    if (unsupportedPlatform) {
      console.error(`Unsupported platform: ${unsupportedPlatform}`)
      console.log(`Supported platforms: ${Object.keys(PLATFORMS).join(", ")}`)
      process.exit(1)
    }
    platformsToDownload = [...new Set(specifiedPlatforms)]
  } else {
    const currentPlatform = `${process.platform}-${process.arch}`
    if (!PLATFORMS[currentPlatform]) {
      console.error(`Unsupported platform: ${currentPlatform}`)
      console.log(`Supported platforms: ${Object.keys(PLATFORMS).join(", ")}`)
      process.exit(1)
    }
    platformsToDownload = [currentPlatform]
  }

  console.log(`\nPlatforms to download: ${platformsToDownload.join(", ")}`)

  ensureRealDirectory(BIN_DIR)

  let success = true
  for (const platformKey of platformsToDownload) {
    const result = await downloadPlatform(version, platformKey, release)
    if (!result) {
      success = false
    }
  }

  if (!success) {
    console.error("\n✗ Some downloads failed")
    process.exit(1)
  }

  console.log("\n✓ All downloads completed successfully!")
}

main().catch((error) => {
  console.error("Fatal error:", error)
  process.exit(1)
})
