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
import {
  downloadFileWithRetry,
  recoverInterruptedFileReplacement,
  replaceFileAtomically,
} from "./lib/download-recovery.mjs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.join(__dirname, "..")
const outputRootArg = process.argv.find((argument) => argument.startsWith("--output-root="))
const BIN_DIR = outputRootArg
  ? path.resolve(outputRootArg.slice("--output-root=".length))
  : path.join(ROOT_DIR, "resources", "bin")
const RELEASE_REPO = "openai/codex"
const RELEASE_TAG_PREFIX = "rust-v"
const USER_AGENT = "flapstack-desktop-codex-downloader"
const GITHUB_API_ORIGIN = "https://api.github.com"
const GITHUB_RELEASE_ORIGIN = "https://github.com"
const MAX_API_REDIRECTS = 5

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

function getRequestHeaders({ api = false, url } = {}) {
  const headers = {
    "User-Agent": USER_AGENT,
    Accept: api ? "application/vnd.github+json" : "application/octet-stream",
  }
  // Authenticate API metadata requests without forwarding repository
  // credentials to signed release-asset redirects on another host.
  const token = process.env.GITHUB_TOKEN
  if (api && token && url && new URL(url).origin === GITHUB_API_ORIGIN) {
    headers.Authorization = `Bearer ${token}`
  }
  return headers
}

export function requireCodexApiUrl(rawUrl) {
  const url = new URL(rawUrl)
  if (url.origin !== GITHUB_API_ORIGIN || url.username || url.password) {
    throw new Error(`Refusing Codex metadata outside ${GITHUB_API_ORIGIN}`)
  }
  return url
}

export function requireCodexReleaseAssetUrl(version, assetName, rawUrl) {
  const url = new URL(rawUrl)
  const expectedPath = `/${RELEASE_REPO}/releases/download/${RELEASE_TAG_PREFIX}${version}/${assetName}`
  if (
    url.origin !== GITHUB_RELEASE_ORIGIN ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== expectedPath
  ) {
    throw new Error(
      `Refusing Codex asset URL that does not match ${RELEASE_REPO} ${RELEASE_TAG_PREFIX}${version} ${assetName}`,
    )
  }
  return url.toString()
}

function fetchJson(rawUrl, redirectCount = 0) {
  const url = requireCodexApiUrl(rawUrl)
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: getRequestHeaders({ api: true, url }) }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          const redirectUrl = res.headers.location
          if (!redirectUrl) {
            return reject(new Error("Missing redirect location"))
          }
          if (redirectCount >= MAX_API_REDIRECTS) {
            return reject(new Error(`More than ${MAX_API_REDIRECTS} Codex API redirects`))
          }
          try {
            const nextUrl = requireCodexApiUrl(new URL(redirectUrl, url).toString())
            return fetchJson(nextUrl, redirectCount + 1)
              .then(resolve)
              .catch(reject)
          } catch (error) {
            return reject(error)
          }
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

function findAsset(release, assetName) {
  const assets = Array.isArray(release?.assets) ? release.assets : []
  return assets.find((asset) => asset?.name === assetName)
}

export async function downloadPlatform(version, platformKey, release, options = {}) {
  const platform = PLATFORMS[platformKey]
  if (!platform) {
    console.error(`Unknown platform: ${platformKey}`)
    return false
  }

  const binDirectory = options.binDirectory ?? BIN_DIR
  const targetDir = path.join(binDirectory, platformKey)
  const targetPath = path.join(targetDir, platform.outputBinaryName)
  const assetHashMarkerPath = path.join(targetDir, ".codex-asset.sha256")
  const binaryHashMarkerPath = path.join(targetDir, ".codex-binary.sha256")

  ensureRealDirectory(binDirectory)
  ensureRealDirectory(targetDir)
  recoverInterruptedFileReplacement(targetPath)

  const asset = findAsset(release, platform.assetName)
  if (!asset) {
    console.error(`Missing release asset ${platform.assetName}`)
    return false
  }

  const expectedHash = parseSha256Digest(asset.digest)
  let downloadUrl
  try {
    downloadUrl = requireCodexReleaseAssetUrl(
      version,
      platform.assetName,
      asset.browser_download_url,
    )
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    return false
  }

  if (!expectedHash) {
    console.error(`Missing SHA256 digest for pinned Codex asset ${platform.assetName}`)
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

  const stagingDirectory = fs.mkdtempSync(path.join(targetDir, ".codex-download-"))
  const downloadPath = path.join(stagingDirectory, platform.assetName)
  const candidatePath = path.join(stagingDirectory, platform.outputBinaryName)
  const extractDir = path.join(stagingDirectory, "extract")
  try {
    await (options.downloadFile ?? downloadFileWithRetry)(downloadUrl, downloadPath, {
      headersForUrl: () => getRequestHeaders(),
      label: `Codex ${platformKey}`,
      onRetry: ({ attempt, attempts, error }) =>
        console.warn(`  ${error.message}; retrying Codex download (${attempt}/${attempts})...`),
    })

    const actualHash = await sha256File(downloadPath)
    if (actualHash !== expectedHash) {
      console.error("  Hash mismatch!")
      console.error(`    Expected: ${expectedHash}`)
      console.error(`    Actual:   ${actualHash}`)
      return false
    }
    console.log(`  Verified SHA256: ${actualHash.slice(0, 16)}...`)

    if (platform.assetName.endsWith(".tar.gz")) {
      fs.mkdirSync(extractDir)

      extractTarGz(downloadPath, extractDir)

      const extractedPath = path.join(extractDir, platform.extractedBinaryName)
      if (!fs.existsSync(extractedPath)) {
        throw new Error(`Extracted binary not found: ${extractedPath}`)
      }
      fs.copyFileSync(extractedPath, candidatePath)
    } else {
      fs.copyFileSync(downloadPath, candidatePath)
    }

    if (!platformKey.startsWith("win32")) fs.chmodSync(candidatePath, 0o755)

    assertBundledBinary(candidatePath, platformKey)
    const binaryHash = await sha256File(candidatePath)
    replaceFileAtomically(candidatePath, targetPath)
    fs.writeFileSync(assetHashMarkerPath, `${expectedHash}\n`)
    fs.writeFileSync(binaryHashMarkerPath, `${binaryHash}\n`)

    console.log(`  Saved to: ${targetPath}`)
    return true
  } finally {
    fs.rmSync(stagingDirectory, { recursive: true, force: true })
  }
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

  const releaseUrl = `https://api.github.com/repos/${RELEASE_REPO}/releases/tags/${RELEASE_TAG_PREFIX}${version}`
  // Codex release metadata is part of the binary trust root. Never let an
  // ignored, mutable local cache supply both an asset digest and its URL.
  const release = await fetchJson(releaseUrl)

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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error("Fatal error:", error)
    process.exit(1)
  })
}
