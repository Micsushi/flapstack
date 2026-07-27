import { spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, join, resolve } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { CredentialService, type CredentialEncryption } from "../src/main/lib/credential-service"
import {
  daemonServiceIdForConfig,
  installWindowsScheduledTask,
  stopInstalledUsageDaemon,
  uninstallWindowsScheduledTask,
  windowsDaemonScriptPath,
} from "../src/main/lib/usage-daemon/platform"

const runLive =
  process.platform === "win32" && process.env.FLAPSTACK_RUN_WINDOWS_PLATFORM_LIVE === "1"
const electron = resolve("node_modules/electron/dist/electron.exe")
const safeStorageHelper = resolve("tests/fixtures/windows-safe-storage-electron.cjs")
const ptyHelper = resolve("tests/fixtures/windows-node-pty-electron.cjs")
const taskFixture = resolve("tests/fixtures/windows-scheduled-task-daemon.cjs")
const cleanupDirectories: string[] = []

function temporaryRoot(label: string) {
  const root = mkdtempSync(join(tmpdir(), `${label} space 雪 & (safe) 100%-`))
  cleanupDirectories.push(root)
  return root
}

function parseLastJsonLine(output: string) {
  const lines = output.trim().split(/\r?\n/)
  return JSON.parse(lines.at(-1) ?? "")
}

function safeStorageCall(request: Record<string, string>) {
  const result = spawnSync(electron, [safeStorageHelper], {
    input: JSON.stringify(request),
    encoding: "utf8",
    windowsHide: true,
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: "true",
    },
  })
  const response = parseLastJsonLine(result.stdout)
  if (result.status !== 0 || !response.ok) {
    throw new Error(response.error ?? result.stderr ?? "safeStorage helper failed")
  }
  return { response, stderr: result.stderr }
}

function windowsEncryption(): CredentialEncryption {
  const inspected = safeStorageCall({ action: "inspect" }).response
  return {
    inspect: () => ({
      available: inspected.available,
      backend: inspected.backend,
    }),
    encrypt: (secret) =>
      Buffer.from(
        safeStorageCall({ action: "encrypt", value: secret }).response.ciphertext,
        "base64",
      ),
    decrypt: (ciphertext) =>
      safeStorageCall({
        action: "decrypt",
        ciphertext: ciphertext.toString("base64"),
      }).response.value,
  }
}

function taskNameForConfig(configDir: string) {
  const id = daemonServiceIdForConfig(configDir)
  return id ? `Flapstack Usage Daemon (${id})` : "Flapstack Usage Daemon"
}

function queryTask(taskName: string) {
  return spawnSync("schtasks.exe", ["/Query", "/TN", taskName, "/FO", "LIST", "/V"], {
    encoding: "utf8",
    windowsHide: true,
  })
}

async function waitFor(path: string, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  while (!existsSync(path)) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${path}`)
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25))
  }
}

afterEach(() => {
  for (const directory of cleanupDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe.runIf(runLive)("native Windows platform acceptance", () => {
  it("persists DPAPI credentials across independent Electron and service restarts", () => {
    const storageDir = join(temporaryRoot("flapstack-dpapi-live"), "data")
    const secretBefore = "flapstack-live-secret-before"
    const secretAfter = "flapstack-live-secret-after"
    const encryption = windowsEncryption()

    expect(encryption.inspect()).toMatchObject({ available: true, backend: "dpapi" })
    const first = new CredentialService({ storageDir, encryption })
    expect(first.set("codex.api-key", secretBefore, { requirePersistence: true })).toMatchObject({
      acknowledged: true,
      persistence: "encrypted",
    })
    const firstRaw = readFileSync(first.storePath, "utf8")
    expect(firstRaw).not.toContain(secretBefore)
    expect(firstRaw).not.toContain(Buffer.from(secretBefore).toString("base64"))

    const restarted = new CredentialService({ storageDir, encryption: windowsEncryption() })
    expect(restarted.resolve("codex.api-key")).toBe(secretBefore)
    expect(restarted.set("codex.api-key", secretAfter, { requirePersistence: true })).toMatchObject(
      { acknowledged: true, persistence: "encrypted" },
    )

    const updated = new CredentialService({ storageDir, encryption: windowsEncryption() })
    expect(updated.resolve("codex.api-key")).toBe(secretAfter)
    const store = JSON.parse(readFileSync(updated.storePath, "utf8"))
    store.credentials["codex.api-key"].ciphertext = Buffer.from("corrupt-dpapi").toString("base64")
    writeFileSync(updated.storePath, `${JSON.stringify(store)}\n`, "utf8")
    const corrupt = new CredentialService({ storageDir, encryption: windowsEncryption() })
    expect(corrupt.resolve("codex.api-key")).toBeNull()
    expect(corrupt.status("codex.api-key").warning).toMatch(/could not be decrypted/i)

    writeFileSync(updated.storePath, firstRaw, "utf8")
    const removable = new CredentialService({ storageDir, encryption: windowsEncryption() })
    expect(removable.remove("codex.api-key").configured).toBe(false)
    expect(
      new CredentialService({ storageDir, encryption: windowsEncryption() }).resolve(
        "codex.api-key",
      ),
    ).toBeNull()
  })

  it("runs PowerShell through the Electron node-pty ABI with exit and cancellation", () => {
    const cwd = temporaryRoot("flapstack-node-pty-live")
    const completionResult = spawnSync(electron, [ptyHelper, cwd, "completion"], {
      encoding: "utf8",
      windowsHide: true,
      env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: "true" },
      timeout: 20_000,
    })

    expect(completionResult.status, completionResult.stderr).toBe(0)
    expect(completionResult.stderr).toBe("")
    const completion = parseLastJsonLine(completionResult.stdout)
    expect(completion).toMatchObject({ platform: "win32", arch: "x64" })
    expect(completion.completion.exitCode).toBe(17)
    expect(completion.completion.output).toContain(`__FLAPSTACK_CWD__${cwd}`)
    expect(completion.completion.output).toContain("__FLAPSTACK_UNICODE__雪")

    const cancellationResult = spawnSync(electron, [ptyHelper, cwd, "cancellation"], {
      encoding: "utf8",
      windowsHide: true,
      env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: "true" },
      timeout: 20_000,
    })
    expect(cancellationResult.status, cancellationResult.stderr).toBe(0)
    expect(cancellationResult.stderr).toBe("")
    const cancellation = parseLastJsonLine(cancellationResult.stdout)
    expect(cancellation.cancellation.output).toContain("__FLAPSTACK_CANCEL_READY__")
    expect(cancellation.cancellation.exitCode).not.toBe(0)
  })

  it("installs, runs, gracefully stops, and removes one isolated Scheduled Task", async () => {
    const root = temporaryRoot("Flapstack Scheduler Live")
    const configDir = join(root, "data")
    const taskName = taskNameForConfig(configDir)
    const readyPath = join(configDir, "live-task-ready.json")
    const stoppedPath = join(configDir, "live-task-stopped.json")
    expect(queryTask(taskName).status).not.toBe(0)

    try {
      installWindowsScheduledTask({
        nodePath: process.execPath,
        daemonEntryPath: taskFixture,
        dbPath: join(configDir, "usage.sqlite"),
        configDir,
        cadenceSeconds: 60,
      })
      try {
        await waitFor(readyPath)
      } catch (error) {
        const task = queryTask(taskName)
        throw new Error(
          `${error instanceof Error ? error.message : String(error)}\n${task.stdout}\n${task.stderr}`,
        )
      }
      expect(JSON.parse(readFileSync(readyPath, "utf8"))).toMatchObject({ configDir })
      expect(queryTask(taskName).status).toBe(0)
      await expect(stopInstalledUsageDaemon(configDir)).resolves.toBe(true)
      await waitFor(stoppedPath)
      expect(JSON.parse(readFileSync(stoppedPath, "utf8"))).toEqual({ graceful: true })
    } finally {
      uninstallWindowsScheduledTask(configDir)
    }

    expect(queryTask(taskName).status).not.toBe(0)
    expect(existsSync(windowsDaemonScriptPath(configDir))).toBe(false)
  }, 30_000)
})
