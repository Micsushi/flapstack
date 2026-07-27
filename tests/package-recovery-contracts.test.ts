import { EventEmitter } from "node:events"
import { createHash } from "node:crypto"
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { PassThrough } from "node:stream"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  downloadFileWithRetry,
  fetchJsonWithCache,
  metadataCachePath,
  recoverInterruptedFileReplacement,
} from "../scripts/lib/download-recovery.mjs"
import {
  acquirePackageOutput,
  completePackageOutput,
  failPackageOutput,
} from "../scripts/lib/package-output-lock.mjs"
import {
  recoverInterruptedDirectoryReplacement,
  replaceDirectoryAtomically,
} from "../scripts/lib/packaged-binary.mjs"
import { downloadPlatform as downloadClaudePlatform } from "../scripts/download-claude-binary.mjs"
import {
  downloadPlatform as downloadCodexPlatform,
  requireCodexApiUrl,
  requireCodexReleaseAssetUrl,
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
    secondWritten.resolve()
    await releaseSecond.promise
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
  it("routes both pinned native downloaders through the shared retry contract", () => {
    for (const script of ["download-claude-binary.mjs", "download-codex-binary.mjs"]) {
      const source = readFileSync(join(process.cwd(), "scripts", script), "utf8")
      expect(source).toMatch(/import[\s\S]*downloadFileWithRetry[\s\S]*download-recovery\.mjs/)
      expect(source).toContain("replaceFileAtomically(")
    }
    expect(
      readFileSync(join(process.cwd(), "scripts", "download-claude-binary.mjs"), "utf8"),
    ).toContain("fetchJsonWithCache(")
    expect(
      readFileSync(join(process.cwd(), "scripts", "download-codex-binary.mjs"), "utf8"),
    ).not.toContain("fetchJsonWithCache(")
  })

  it("accepts only the exact OpenAI Codex tag asset URL", () => {
    const exact =
      "https://github.com/openai/codex/releases/download/rust-v0.144.1/codex-x86_64-pc-windows-msvc.exe"
    expect(requireCodexReleaseAssetUrl("0.144.1", "codex-x86_64-pc-windows-msvc.exe", exact)).toBe(
      exact,
    )
    for (const invalid of [
      "https://example.invalid/codex.exe",
      "https://github.com/attacker/codex/releases/download/rust-v0.144.1/codex-x86_64-pc-windows-msvc.exe",
      "https://github.com/openai/codex/releases/download/rust-v0.144.2/codex-x86_64-pc-windows-msvc.exe",
      `${exact}?redirect=1`,
    ]) {
      expect(() =>
        requireCodexReleaseAssetUrl("0.144.1", "codex-x86_64-pc-windows-msvc.exe", invalid),
      ).toThrow(/Refusing Codex asset URL/)
    }
  })

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

  it("keeps untrusted version labels inside the metadata cache", () => {
    const root = temporaryDirectory()
    const cachePath = metadataCachePath(root, "claude", "../../outside")
    expect(cachePath.startsWith(`${root}\\`) || cachePath.startsWith(`${root}/`)).toBe(true)
    expect(cachePath).not.toContain("outside")
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

  it("removes the temporary file after retry exhaustion", async () => {
    const directory = temporaryDirectory()
    const target = join(directory, "binary.download")
    const get = fakeGet([new Error("offline"), new Error("offline"), new Error("offline")])

    await expect(
      downloadFileWithRetry("https://example.invalid/binary", target, {
        get,
        retryDelay: async () => {},
        label: "test binary",
      }),
    ).rejects.toThrow(/test binary.*3 attempts.*offline/i)

    expect(existsSync(target)).toBe(false)
  })

  it("uses cached metadata when the network is offline and reports a repairable cache miss", async () => {
    const directory = temporaryDirectory()
    const cachePath = join(directory, "manifest.json")
    writeFileSync(cachePath, JSON.stringify({ version: "cached" }))

    await expect(
      fetchJsonWithCache(
        "https://example.invalid/manifest.json",
        cachePath,
        async () => {
          throw new Error("offline")
        },
        { label: "Claude manifest" },
      ),
    ).resolves.toEqual({ version: "cached" })

    const missingPath = join(directory, "missing.json")
    await expect(
      fetchJsonWithCache(
        "https://example.invalid/manifest.json",
        missingPath,
        async () => {
          throw new Error("offline")
        },
        { label: "Claude manifest" },
      ),
    ).rejects.toThrow(/Claude manifest unavailable.*cache miss.*rerun.*network/i)
    expect(existsSync(`${missingPath}.download`)).toBe(false)
  })

  it("preserves the last verified Claude binary when a replacement download fails", async () => {
    const binDirectory = temporaryDirectory()
    const targetDirectory = join(binDirectory, "win32-x64")
    const target = join(targetDirectory, "claude.exe")
    mkdirSync(targetDirectory)
    const previous = peX64("previous")
    writeFileSync(target, previous)
    const replacement = peX64("replacement")
    const checksum = createHash("sha256").update(replacement).digest("hex")

    await expect(
      downloadClaudePlatform(
        "2.1.207",
        "win32-x64",
        { platforms: { "win32-x64": { checksum, size: replacement.length } } },
        {
          binDirectory,
          downloadFile: async (_url, destination) => {
            writeFileSync(destination, replacement.subarray(0, 20))
            throw new Error("offline")
          },
        },
      ),
    ).rejects.toThrow(/offline/)

    expect(readFileSync(target)).toEqual(previous)
    expect(existsSync(`${target}.download`)).toBe(false)
  })

  it("preserves the last verified Codex binary when a replacement download fails", async () => {
    const binDirectory = temporaryDirectory()
    const targetDirectory = join(binDirectory, "win32-x64")
    const target = join(targetDirectory, "codex.exe")
    mkdirSync(targetDirectory)
    const previous = peX64("previous")
    writeFileSync(target, previous)
    const replacement = peX64("replacement")
    const checksum = createHash("sha256").update(replacement).digest("hex")

    await expect(
      downloadCodexPlatform(
        "0.144.1",
        "win32-x64",
        {
          assets: [
            {
              name: "codex-x86_64-pc-windows-msvc.exe",
              digest: `sha256:${checksum}`,
              browser_download_url:
                "https://github.com/openai/codex/releases/download/rust-v0.144.1/codex-x86_64-pc-windows-msvc.exe",
              size: replacement.length,
            },
          ],
        },
        {
          binDirectory,
          downloadFile: async (_url, destination) => {
            writeFileSync(destination, replacement.subarray(0, 20))
            throw new Error("offline")
          },
        },
      ),
    ).rejects.toThrow(/offline/)

    expect(readFileSync(target)).toEqual(previous)
    expect(existsSync(join(targetDirectory, "codex-x86_64-pc-windows-msvc.exe.download"))).toBe(
      false,
    )
    expect(existsSync(`${target}.candidate`)).toBe(false)
  })

  it.each(["claude", "codex"] as const)(
    "isolates concurrent %s binary download staging",
    async (runtime) => {
      const binDirectory = temporaryDirectory()
      const replacement = peX64("concurrent")
      const checksum = createHash("sha256").update(replacement).digest("hex")
      const download =
        runtime === "claude"
          ? (downloadFile: (_url: string, destination: string) => Promise<void>) =>
              downloadClaudePlatform(
                "2.1.207",
                "win32-x64",
                { platforms: { "win32-x64": { checksum, size: replacement.length } } },
                { binDirectory, downloadFile },
              )
          : (downloadFile: (_url: string, destination: string) => Promise<void>) =>
              downloadCodexPlatform(
                "0.144.1",
                "win32-x64",
                {
                  assets: [
                    {
                      name: "codex-x86_64-pc-windows-msvc.exe",
                      digest: `sha256:${checksum}`,
                      browser_download_url:
                        "https://github.com/openai/codex/releases/download/rust-v0.144.1/codex-x86_64-pc-windows-msvc.exe",
                      size: replacement.length,
                    },
                  ],
                },
                { binDirectory, downloadFile },
              )

      await runConcurrentDownloads(download, replacement)

      expect(
        readFileSync(
          join(binDirectory, "win32-x64", runtime === "claude" ? "claude.exe" : "codex.exe"),
        ),
      ).toEqual(replacement)
    },
  )

  it("restores a verified target left in the deterministic replacement backup", () => {
    const directory = temporaryDirectory()
    const target = join(directory, "claude.exe")
    const backup = `${target}.replacement-backup`
    writeFileSync(target, peX64("verified"))
    renameSync(target, backup)

    recoverInterruptedFileReplacement(target)

    expect(readFileSync(target)).toEqual(peX64("verified"))
    expect(existsSync(backup)).toBe(false)
  })
})

describe("package output recovery", () => {
  it("holds the heavy-job lock across native ABI preparation and every direct package build", () => {
    const packageSource = readFileSync(join(process.cwd(), "scripts", "package-app.mjs"), "utf8")
    const scripts = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")).scripts
    expect(packageSource).toContain("FLAPSTACK_HEAVY_JOB_LOCK_TOKEN")
    expect(packageSource).toContain("with-heavy-job-lock.mjs")
    expect(packageSource).toContain("--ensure-native-abi")
    expect(scripts["package:preview:win"]).toContain("--ensure-native-abi")
    expect(scripts["package:preview:mac"]).toContain("--ensure-native-abi")
    expect(scripts["package:preview:win"]).not.toContain("&&")
    expect(scripts["package:preview:mac"]).not.toContain("&&")
  })

  it("does not steal a newly-created lock whose owner file is not visible yet", () => {
    const root = temporaryDirectory()
    const lockPath = join(root, "node_modules", ".flapstack-package-locks", "package-app.lock")
    mkdirSync(lockPath, { recursive: true })
    const startedAt = statSync(lockPath).mtimeMs

    expect(() =>
      acquirePackageOutput({
        root,
        outputDirectory: join(root, "release-preview"),
        pid: 456,
        now: startedAt + 1_000,
        incompleteOwnerGraceMs: 5_000,
        isProcessAlive: () => false,
      }),
    ).toThrow(/still starting/i)
    expect(statSync(lockPath).isDirectory()).toBe(true)
  })

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

  it("does not release a package lock after its owner identity changes", () => {
    const root = temporaryDirectory()
    const output = join(root, "release-preview")
    const first = acquirePackageOutput({ root, outputDirectory: output, pid: 123 })
    writeFileSync(
      join(first.lockPath, "owner.json"),
      `${JSON.stringify({ ...first.owner, pid: 456, token: "replacement-owner" })}\n`,
    )

    expect(() => completePackageOutput(first)).toThrow(/ownership changed/i)
    expect(existsSync(first.lockPath)).toBe(true)
  })

  it("serializes different outputs that share package resources and native ABI", () => {
    const root = temporaryDirectory()
    const preview = acquirePackageOutput({
      root,
      outputDirectory: join(root, "release-preview"),
      pid: 123,
    })
    expect(() =>
      acquirePackageOutput({
        root,
        outputDirectory: join(root, "release"),
        pid: 456,
        isProcessAlive: (pid) => pid === 123,
      }),
    ).toThrow(/already in progress.*123/i)
    completePackageOutput(preview)
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

  it("reclaims an expired lock even if its PID was reused", () => {
    const root = temporaryDirectory()
    const output = join(root, "release-preview")
    const first = acquirePackageOutput({ root, outputDirectory: output, pid: 123, now: 1_000 })
    failPackageOutput(first)

    const recovered = acquirePackageOutput({
      root,
      outputDirectory: output,
      pid: 456,
      now: 10_000,
      staleAfterMs: 1_000,
      isProcessAlive: () => true,
    })

    expect(statSync(recovered.lockPath).isDirectory()).toBe(true)
    completePackageOutput(recovered)
  })

  it("holds the output contract across all package steps and records failure for recovery", async () => {
    const root = temporaryDirectory()
    const outputDirectory = join(root, "release-preview")
    const calls: string[] = []
    const build = {
      targets: ["win32-x64"],
      builderArgs: ["--win", "--x64", "--dir"],
      outputDirectory,
    }

    await expect(
      executePackageBuild(build, {
        root,
        writeProvenance: () => calls.push("provenance"),
        prepareNotices: () => calls.push("notices"),
        prepareResources: async () => calls.push("resources"),
        builder: () => {
          calls.push("builder")
          throw new Error("builder interrupted")
        },
      }),
    ).rejects.toThrow(/builder interrupted/)

    expect(calls).toEqual(["provenance", "notices", "resources", "builder"])
    expect(existsSync(join(outputDirectory, ".flapstack-package-incomplete"))).toBe(true)
    expect(
      existsSync(join(root, "node_modules", ".flapstack-package-locks", "package-app.lock")),
    ).toBe(false)

    await executePackageBuild(build, {
      root,
      writeProvenance: () => {},
      prepareNotices: () => {},
      prepareResources: async () => {},
      builder: () => writeFileSync(join(outputDirectory, "recovered.exe"), "complete"),
    })
    expect(readFileSync(join(outputDirectory, "recovered.exe"), "utf8")).toBe("complete")
    expect(existsSync(join(outputDirectory, ".flapstack-package-incomplete"))).toBe(false)
  })

  it("starts each successful package from an empty output and drops stale older artifacts", async () => {
    const root = temporaryDirectory()
    const outputDirectory = join(root, "release-preview")
    mkdirSync(outputDirectory)
    writeFileSync(join(outputDirectory, "stale-installer.exe"), "old")
    const build = {
      targets: ["win32-x64"],
      builderArgs: ["--win", "--x64", "--dir"],
      outputDirectory,
    }

    await executePackageBuild(build, {
      root,
      writeProvenance: () => {},
      prepareNotices: () => {},
      prepareResources: async () => {},
      builder: () => writeFileSync(join(outputDirectory, "current-installer.exe"), "current"),
    })

    expect(existsSync(join(outputDirectory, "stale-installer.exe"))).toBe(false)
    expect(readFileSync(join(outputDirectory, "current-installer.exe"), "utf8")).toBe("current")
  })

  it("captures source provenance before moving the previous output into a transaction backup", async () => {
    const root = temporaryDirectory()
    const outputDirectory = join(root, "release-preview")
    const backupDirectory = join(root, ".release-preview.package-backup")
    mkdirSync(outputDirectory)
    writeFileSync(join(outputDirectory, "previous.exe"), "previous")

    await executePackageBuild(
      {
        targets: ["win32-x64"],
        builderArgs: ["--win", "--x64", "--dir"],
        outputDirectory,
      },
      {
        root,
        writeProvenance: () => {
          expect(existsSync(join(outputDirectory, "previous.exe"))).toBe(true)
          expect(existsSync(backupDirectory)).toBe(false)
        },
        prepareNotices: () => {},
        prepareResources: async () => {},
        builder: () => writeFileSync(join(outputDirectory, "current.exe"), "current"),
      },
    )

    expect(readFileSync(join(outputDirectory, "current.exe"), "utf8")).toBe("current")
    expect(existsSync(backupDirectory)).toBe(false)
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

  it("atomically replaces the full directory without retaining stale files", () => {
    const parent = temporaryDirectory()
    const target = join(parent, "win32-x64")
    const staging = join(parent, ".win32-x64.staging")
    mkdirSync(target)
    mkdirSync(staging)
    writeFileSync(join(target, "stale.exe"), "old")
    writeFileSync(join(staging, "current.exe"), "new")

    replaceDirectoryAtomically(staging, target)

    expect(existsSync(join(target, "stale.exe"))).toBe(false)
    expect(readFileSync(join(target, "current.exe"), "utf8")).toBe("new")
    expect(existsSync(join(parent, ".win32-x64.replacement-backup"))).toBe(false)
  })
})
