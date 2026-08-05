import fs from "node:fs"
import https from "node:https"
import path from "node:path"
import { createHash } from "node:crypto"
import { pipeline } from "node:stream/promises"

const DEFAULT_RETRY_STATUSES = new Set([403, 408, 429, 500, 502, 503, 504])

function requestResponse(get, url, headers) {
  return new Promise((resolve, reject) => {
    const request = get(url, { headers }, resolve)
    request.once("error", reject)
  })
}

async function responseForUrl(get, initialUrl, headersForUrl, maxRedirects) {
  let url = initialUrl
  for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
    const response = await requestResponse(get, url, headersForUrl(url))
    if (response.statusCode !== 301 && response.statusCode !== 302) {
      return { response, url }
    }
    const location = response.headers.location
    response.resume()
    if (!location) throw new Error("redirect response is missing Location")
    if (redirect === maxRedirects) throw new Error(`more than ${maxRedirects} redirects`)
    url = new URL(location, url).toString()
  }
  throw new Error("unreachable redirect state")
}

function statusError(status) {
  const error = new Error(`HTTP ${status}`)
  error.status = status
  return error
}

async function removePartial(filePath) {
  await fs.promises.rm(filePath, { force: true })
}

export async function downloadFileWithRetry(url, destination, options = {}) {
  const get = options.get ?? https.get
  const attempts = options.attempts ?? 3
  const retryStatuses = options.retryStatuses ?? DEFAULT_RETRY_STATUSES
  const retryDelay =
    options.retryDelay ??
    ((attempt) => new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** (attempt - 1))))
  const headersForUrl = options.headersForUrl ?? (() => ({}))
  const label = options.label ?? "download"
  const maxRedirects = options.maxRedirects ?? 5
  let lastError

  await removePartial(destination)
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let response
    try {
      const opened = await responseForUrl(get, url, headersForUrl, maxRedirects)
      response = opened.response
      const status = response.statusCode ?? 0
      if (status !== 200) {
        response.resume()
        throw statusError(status)
      }

      const expectedLength = Number.parseInt(response.headers["content-length"] ?? "", 10)
      let receivedLength = 0
      response.on("data", (chunk) => {
        receivedLength += chunk.length
      })
      await pipeline(response, fs.createWriteStream(destination, { flags: "wx" }))
      if (
        Number.isFinite(expectedLength) &&
        expectedLength >= 0 &&
        receivedLength !== expectedLength
      ) {
        throw new Error(
          `content-length mismatch: expected ${expectedLength} bytes, received ${receivedLength}`,
        )
      }
      return
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      response?.destroy()
      await removePartial(destination)
      const retryableStatus =
        typeof lastError.status === "number" && retryStatuses.has(lastError.status)
      const retryableTransport = typeof lastError.status !== "number"
      if (attempt >= attempts || (!retryableStatus && !retryableTransport)) break
      options.onRetry?.({ attempt: attempt + 1, attempts, error: lastError })
      await retryDelay(attempt)
    }
  }

  throw new Error(
    `${label} failed after ${attempts} attempts: ${lastError?.message ?? "unknown error"}`,
  )
}

function assertRegularFile(filePath) {
  const stat = fs.lstatSync(filePath)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("cache is not a regular file")
}

function writeJsonAtomically(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.download`
  fs.rmSync(temporaryPath, { force: true })
  try {
    fs.writeFileSync(temporaryPath, `${JSON.stringify(value)}\n`, { flag: "wx", mode: 0o600 })
    replaceFileAtomically(temporaryPath, filePath)
  } finally {
    fs.rmSync(temporaryPath, { force: true })
  }
}

export async function fetchJsonWithCache(url, cachePath, fetcher, options = {}) {
  const label = options.label ?? "download metadata"
  try {
    const value = await fetcher(url)
    writeJsonAtomically(cachePath, value)
    return value
  } catch (networkError) {
    try {
      assertRegularFile(cachePath)
      const cached = JSON.parse(fs.readFileSync(cachePath, "utf8"))
      options.onCacheFallback?.(networkError)
      return cached
    } catch (cacheError) {
      fs.rmSync(`${cachePath}.download`, { force: true })
      throw new Error(
        `${label} unavailable (${networkError instanceof Error ? networkError.message : networkError}); cache miss or invalid cache (${cacheError instanceof Error ? cacheError.message : cacheError}). Rerun with network access.`,
      )
    }
  }
}

export function metadataCachePath(cacheRoot, provider, version) {
  const safeProvider = String(provider).replaceAll(/[^a-zA-Z0-9_-]/g, "_")
  const versionKey = createHash("sha256").update(String(version)).digest("hex").slice(0, 24)
  return path.join(path.resolve(cacheRoot), `${safeProvider}-${versionKey}.json`)
}

export function recoverInterruptedFileReplacement(targetPath) {
  const backupPath = `${targetPath}.replacement-backup`
  if (!fs.existsSync(backupPath)) return
  const backup = fs.lstatSync(backupPath)
  if (!backup.isFile() || backup.isSymbolicLink()) {
    throw new Error(`${backupPath}: replacement backup must be a regular file`)
  }
  if (fs.existsSync(targetPath)) {
    const target = fs.lstatSync(targetPath)
    if (!target.isFile() || target.isSymbolicLink()) {
      throw new Error(`${targetPath}: replacement target must be a regular file`)
    }
    fs.rmSync(backupPath, { force: true })
    return
  }
  fs.renameSync(backupPath, targetPath)
}

export function replaceFileAtomically(stagingPath, targetPath) {
  recoverInterruptedFileReplacement(targetPath)
  const staging = fs.lstatSync(stagingPath)
  if (!staging.isFile() || staging.isSymbolicLink()) {
    throw new Error(`${stagingPath}: replacement must be a regular file`)
  }
  const backupPath = `${targetPath}.replacement-backup`
  let previousMoved = false
  try {
    const target = fs.lstatSync(targetPath)
    if (!target.isFile() || target.isSymbolicLink()) {
      throw new Error(`${targetPath}: existing target must be a regular file`)
    }
    fs.renameSync(targetPath, backupPath)
    previousMoved = true
  } catch (error) {
    if (error?.code !== "ENOENT") throw error
  }
  try {
    fs.renameSync(stagingPath, targetPath)
  } catch (error) {
    if (previousMoved) fs.renameSync(backupPath, targetPath)
    throw error
  }
  if (previousMoved) fs.rmSync(backupPath, { force: true })
}
