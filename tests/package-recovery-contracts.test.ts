import { EventEmitter } from "node:events"
import { createHash } from "node:crypto"
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { PassThrough } from "node:stream"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { downloadFileWithRetry } from "../scripts/lib/download-recovery.mjs"
import {
  acquirePackageOutput,
  completePackageOutput,
  failPackageOutput,
} from "../scripts/lib/package-output-lock.mjs"
import { recoverInterruptedDirectoryReplacement } from "../scripts/lib/packaged-binary.mjs"
import {
  downloadPlatform as downloadCodexPlatform,
  requireCodexApiUrl,
} from "../scripts/download-codex-binary.mjs"
import { executePackageBuild } from "../scripts/package-app.mjs"

const directories: string[] = []

afterEach(() => {
  while (directories.length > 0) rmSync(directories.pop()!, { recursive: true, force: true })
})

function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), "flapstack-package-recovery-"))
  directories.push(directory)
  return directory
}

function response(statusCode: number, headers: Record<string, string> = {}) {
  const stream = new PassThrough() as PassThrough & {
    statusCode: number
    headers: Record<string, string>
  }
  stream.statusCode = statusCode
  stream.headers = headers
  return stream
}

function fakeGet(
  handlers: Array<
    { status: number; body?: string; headers?: Record<string, string>; failAfter?: string } | Error
  >,
) {
  return vi.fn((_url: string, _options: unknown, callback: (value: PassThrough) => void) => {
    const request = new EventEmitter()
    const handler = handlers.shift()
    queueMicrotask(() => {
      if (handler instanceof Error) {
        request.emit("error", handler)
        return
      }
      if (!handler) {
        request.emit("error", new Error("unexpected request"))
        return
      }
      const stream = response(handler.status, handler.headers)
      callback(stream)
      queueMicrotask(() => {
        if (handler.failAfter !== undefined) {
          stream.write(handler.failAfter)
          stream.destroy(new Error("connection reset"))
        } else {
          stream.end(handler.body ?? "")
        }
      })
    })
    return request
  })
}

function peX64(payload = "") {
  const buffer = Buffer.alloc(136 + Buffer.byteLength(payload))
  buffer.write("MZ", 0, "ascii")
  buffer.writeUInt32LE(128, 0x3c)
  buffer.write("PE\0\0", 128, "ascii")
  buffer.writeUInt16LE(0x8664, 132)
  buffer.write(payload, 136)
  return buffer
}

function codexWindowsRelease(codex: Buffer, codeModeHost = codex) {
  const asset = (name: string, bytes: Buffer) => ({
    name,
    digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    browser_download_url: `https://github.com/openai/codex/releases/download/rust-v0.153.4/${name}`,
    size: bytes.length,
  })
  return {
    assets: [
      asset("codex-x86_64-pc-windows-msvc.exe", codex),
      asset("codex-code-mode-host-x86_64-pc-windows-msvc.exe", codeModeHost),
      asset("codex-command-runner-x86_64-pc-windows-msvc.exe", codex),
      asset("codex-windows-sandbox-setup-x86_64-pc-windows-msvc.exe", codex),
    ],
  }
}

function deferred() {
  let resolvePromise!: () => void
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve
  })
  return { promise, resolve: resolvePromise }
}

async function runConcurrentDownloads(
  download: (downloadFile: (_url: string, destination: string) => Promise<void>) => Promise<void>,
  payload: Buffer,
) {
  const firstWritten = deferred()
  const secondWritten = deferred()
  const releaseSecond = deferred()
  let call = 0
  const downloadFile = async (_url: string, destination: string) => {
    call += 1
    writeFileSync(destination, payload)
    if (call === 1) {
      firstWritten.resolve()
      await secondWritten.promise
      return
    }
    if (call === 2) {
      secondWritten.resolve()
      await releaseSecond.promise
    }
  }

  const first = download(downloadFile)
  await firstWritten.promise
  const second = download(downloadFile)
  await secondWritten.promise
  await first
  releaseSecond.resolve()
  await second
}

describe("binary download recovery", () => {
  it("never follows Codex metadata outside the exact GitHub API origin", () => {
    expect(
      requireCodexApiUrl("https://api.github.com/repos/openai/codex/releases/latest").origin,
    ).toBe("https://api.github.com")
    expect(() =>
      requireCodexApiUrl("https://objects.githubusercontent.com/redirected-metadata"),
    ).toThrow(/Refusing Codex metadata/)
    expect(() => requireCodexApiUrl("https://token@example.invalid/redirected-metadata")).toThrow(
      /Refusing Codex metadata/,
    )
  })

  it("retries transient status and partial-stream failures without retaining partial bytes", async () => {
    const directory = temporaryDirectory()
    const target = join(directory, "binary.download")
    const get = fakeGet([
      { status: 503 },
      { status: 200, failAfter: "partial", headers: { "content-length": "12" } },
      { status: 200, body: "complete", headers: { "content-length": "8" } },
    ])

    await downloadFileWithRetry("https://example.invalid/binary", target, {
      get,
      retryDelay: async () => {},
      label: "test binary",
    })

    expect(readFileSync(target, "utf8")).toBe("complete")
    expect(get).toHaveBeenCalledTimes(3)
  })

  it("preserves the last verified Codex binary when a replacement download fails", async () => {
    const binDirectory = temporaryDirectory()
    const targetDirectory = join(binDirectory, "win32-x64")
    const target = join(targetDirectory, "codex.exe")
    mkdirSync(targetDirectory)
    const previous = peX64("previous")
    writeFileSync(target, previous)
    const replacement = peX64("replacement")

    await expect(
      downloadCodexPlatform("0.153.4", "win32-x64", codexWindowsRelease(replacement), {
        binDirectory,
        downloadFile: async (_url, destination) => {
          writeFileSync(destination, replacement.subarray(0, 20))
          throw new Error("offline")
        },
      }),
    ).rejects.toThrow(/offline/)

    expect(readFileSync(target)).toEqual(previous)
    expect(existsSync(join(targetDirectory, "codex-x86_64-pc-windows-msvc.exe.download"))).toBe(
      false,
    )
    expect(existsSync(`${target}.candidate`)).toBe(false)
  })
})

describe("package output recovery", () => {
  it("rejects a concurrent live owner without changing its output", () => {
    const root = temporaryDirectory()
    const output = join(root, "release-preview")
    mkdirSync(output)
    writeFileSync(join(output, "existing.txt"), "keep")
    const first = acquirePackageOutput({ root, outputDirectory: output, pid: 123 })
    writeFileSync(join(output, "current-build.txt"), "keep")
    expect(first.lockPath).toBe(
      join(root, "node_modules", ".flapstack-package-locks", "package-app.lock"),
    )

    expect(() =>
      acquirePackageOutput({
        root,
        outputDirectory: output,
        pid: 456,
        isProcessAlive: (pid) => pid === 123,
      }),
    ).toThrow(/already in progress.*123/i)
    expect(readFileSync(join(output, "current-build.txt"), "utf8")).toBe("keep")

    completePackageOutput(first)
  })

  it("reclaims a dead owner and removes only its interrupted output", () => {
    const root = temporaryDirectory()
    const output = join(root, "release-preview")
    const unrelated = join(root, "release")
    mkdirSync(output)
    mkdirSync(unrelated)
    writeFileSync(join(output, "partial.exe"), "partial")
    writeFileSync(join(unrelated, "good.exe"), "good")
    const interrupted = acquirePackageOutput({ root, outputDirectory: output, pid: 123 })
    failPackageOutput(interrupted)

    const recovered = acquirePackageOutput({
      root,
      outputDirectory: output,
      pid: 456,
      isProcessAlive: () => false,
    })

    expect(existsSync(join(output, "partial.exe"))).toBe(false)
    expect(readFileSync(join(unrelated, "good.exe"), "utf8")).toBe("good")
    expect(existsSync(recovered.incompleteMarkerPath)).toBe(true)
    writeFileSync(join(output, "new.exe"), "new")
    completePackageOutput(recovered)
    expect(existsSync(recovered.incompleteMarkerPath)).toBe(false)
    expect(existsSync(recovered.lockPath)).toBe(false)
  })

  it("keeps the previous package when the current application build fails", async () => {
    const root = temporaryDirectory()
    const outputDirectory = join(root, "release-preview")
    mkdirSync(outputDirectory)
    writeFileSync(join(outputDirectory, "previous.exe"), "previous")

    await expect(
      executePackageBuild(
        {
          targets: ["win32-x64"],
          builderArgs: ["--win", "--x64", "--dir"],
          outputDirectory,
        },
        {
          root,
          buildApp: () => {
            throw new Error("source build failed")
          },
          writeProvenance: () => {
            throw new Error("provenance should not run")
          },
        },
      ),
    ).rejects.toThrow(/source build failed/)

    expect(readFileSync(join(outputDirectory, "previous.exe"), "utf8")).toBe("previous")
    expect(existsSync(join(outputDirectory, ".flapstack-package-incomplete"))).toBe(false)
  })
})

describe("directory replacement recovery", () => {
  it("restores a deterministic last-known-good directory after interruption", () => {
    const parent = temporaryDirectory()
    const target = join(parent, "win32-x64")
    const backup = join(parent, ".win32-x64.replacement-backup")
    mkdirSync(target)
    writeFileSync(join(target, "binary.exe"), "known-good")
    renameSync(target, backup)

    recoverInterruptedDirectoryReplacement(target)

    expect(readFileSync(join(target, "binary.exe"), "utf8")).toBe("known-good")
    expect(existsSync(backup)).toBe(false)
  })
})
