import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { childEnvironment, samePath } from "./qualify-packaged-native-windows.mjs"

export async function main() {
  assert.equal(
    process.env.FLAPSTACK_RUN_PACKAGED_RECORDS_QUALIFICATION,
    "1",
    "Explicit isolated qualification opt-in required",
  )
  assert.equal(process.platform, "win32", "Windows qualification only")
  assert.equal(process.versions.node.split(".")[0], "22", "Node 22 required")
  const executable = resolve(
    process.argv[2] ?? "release-preview/win-unpacked/Flapstack Preview.exe",
  )
  assert.equal(basename(executable), "Flapstack Preview.exe")
  const resources = join(dirname(executable), "resources")
  const archive = join(resources, "project-records-runtime.json.gz")
  assert(existsSync(archive), "Packaged Records runtime resource is required")
  const provenance = JSON.parse(readFileSync(join(resources, "package-provenance.json"), "utf8"))
  assert.equal(provenance.build.channel, "preview")
  const require = createRequire(import.meta.url)
  const { _electron } = require(process.env.FLAPSTACK_QUALIFICATION_PLAYWRIGHT || "playwright")
  const ownedRoot = mkdtempSync(join(tmpdir(), "flapstack-records-qualification-"))
  const identity = `${process.pid}-${Date.now().toString(36)}`
  const profile = join(ownedRoot, `Flapstack Preview preview-bridge-${identity}`)
  const env = childEnvironment(
    process.env,
    identity,
    join(ownedRoot, "codex"),
    join(ownedRoot, "claude"),
  )
  for (const key of Object.keys(env)) if (key.startsWith("PROJECT_RECORDS_")) delete env[key]
  delete env.NODE_PATH
  delete env.NODE_OPTIONS
  env.FLAPSTACK_PROJECT_RECORDS_PYTHON = process.env.FLAPSTACK_PROJECT_RECORDS_PYTHON || "python"
  const reportPath = resolve(process.argv[3] ?? `.local-evidence/packaged-records-${identity}.json`)
  const report = {
    status: "running",
    surface: "hidden-window",
    providersLaunched: false,
    runtimeSha256: createHash("sha256").update(readFileSync(archive)).digest("hex"),
    checks: [],
  }
  let app, page
  let safeToRemove = true
  async function start(launchEnv = env, expectedProfile = profile) {
    safeToRemove = false
    app = await _electron.launch({
      executablePath: executable,
      args: [`--user-data-dir=${join(ownedRoot, "seed")}`],
      cwd: ownedRoot,
      env: launchEnv,
      timeout: 60000,
    })
    page = await app.firstWindow({ timeout: 60000 })
    await page.waitForLoadState("domcontentloaded")
    const actual = await app.evaluate(({ app, BrowserWindow }) => ({
      packaged: app.isPackaged,
      profile: app.getPath("userData"),
      hidden: BrowserWindow.getAllWindows().every((window) => !window.isVisible()),
      archive: require("node:fs").existsSync(
        require("node:path").join(process.resourcesPath, "project-records-runtime.json.gz"),
      ),
      authAbsent:
        !process.env.FLAPSTACK_PROJECT_RECORDS_TOKEN &&
        !process.env.FLAPSTACK_PROJECT_RECORDS_TOKEN_FILE &&
        !process.env.PROJECT_RECORDS_TOKEN &&
        !process.env.PROJECT_RECORDS_TOKEN_FILE,
      sourceAbsent: !process.env.FLAPSTACK_PROJECT_RECORDS_SOURCE,
    }))
    assert.equal(actual.packaged, true)
    assert.equal(samePath(actual.profile, expectedProfile), true, "Must use owned fresh profile")
    assert.equal(actual.hidden, true, "Qualification must stay hidden")
    assert.equal(actual.archive, true)
    assert.equal(actual.authAbsent, true)
    assert.equal(actual.sourceAbsent, true)
    await page.evaluate(() => {
      const pending = new Map()
      let sequence = 800000
      window.electronTRPC.onMessage((response) => {
        const request = pending.get(response.id)
        if (!request) return
        if (response.error) {
          clearTimeout(request.timer)
          pending.delete(response.id)
          const message = response.error.json?.message ?? response.error.message
          request.reject(
            new Error(
              typeof message === "string"
                ? message
                : "Production Records RPC rejected qualification",
            ),
          )
        } else if (response.result?.type === "data") {
          clearTimeout(request.timer)
          pending.delete(response.id)
          request.resolve(response.result.data?.json ?? response.result.data)
        }
      })
      window.recordsQualificationRpc = (path, input, type) =>
        new Promise((resolve, reject) => {
          const id = ++sequence
          const timer = setTimeout(() => {
            pending.delete(id)
            reject(new Error("Records RPC timeout"))
          }, 30000)
          pending.set(id, { resolve, reject, timer })
          window.electronTRPC.sendMessage({
            method: "request",
            operation: { id, type, path, input: { json: input }, context: {} },
          })
        })
    })
  }
  async function close() {
    if (!app) return
    await app.close()
    app = undefined
    safeToRemove = true
  }
  const rpc = (path, input, type = "query") =>
    page.evaluate(({ path, input, type }) => window.recordsQualificationRpc(path, input, type), {
      path,
      input,
      type,
    })
  const board = (path) => rpc("projectRecords.boardRequest", { path, method: "GET" }, "mutation")
  try {
    const missingPythonEnv = {
      ...env,
      FLAPSTACK_PREVIEW_INSTANCE: `preview-bridge-${identity}-missing-python`,
      FLAPSTACK_PROJECT_RECORDS_PYTHON: join(ownedRoot, "nonexistent-python.exe"),
    }
    const missingPythonProfile = join(
      ownedRoot,
      `Flapstack Preview preview-bridge-${identity}-missing-python`,
    )
    assert(!existsSync(missingPythonProfile), "Failure profile must start empty")
    await start(missingPythonEnv, missingPythonProfile)
    await assert.rejects(
      board("/v1/storage"),
      /Records requires Python 3.*FLAPSTACK_PROJECT_RECORDS_PYTHON/,
    )
    assert.equal(await rpc("planSources.recordsMode"), true)
    await assert.rejects(
      rpc(
        "tasks.create",
        { projectId: "no-project-must-be-created", name: "Must be refused" },
        "mutation",
      ),
      /Project records owns task transitions/,
    )
    assert(!existsSync(join(missingPythonProfile, "project-records", "records.sqlite3")))
    report.checks.push("missing-python-actionable-error", "missing-python-no-legacy-fallback")
    await close()
    assert(!existsSync(profile), "Profile must start empty")
    await start()
    assert.equal(JSON.parse((await board("/v1/storage")).body).backend, "sqlite")
    assert(existsSync(join(profile, "project-records", "records.sqlite3")))
    report.checks.push(
      "packaged-hidden-isolated",
      "default-standalone-sqlite",
      "owner-auth-not-inherited",
    )
    const created = await rpc(
      "projectRecords.create",
      {
        kind: "task",
        title: "Cold packaged Records proof",
        description: "No worker or provider launch; verify local task persistence.",
        projectId: "qualification",
        projectName: "Qualification",
        requestId: `packaged-${identity}`,
      },
      "mutation",
    )
    const before = JSON.parse(
      (await board(`/v1/document?path=${encodeURIComponent(created.path)}`)).body,
    )
    assert.equal(
      before.document.records.find((record) => record.id === created.recordId)?.title,
      "Cold packaged Records proof",
    )
    report.checks.push("board-create-read")
    await close()
    await start()
    const after = JSON.parse(
      (await board(`/v1/document?path=${encodeURIComponent(created.path)}`)).body,
    )
    assert.equal(after.revision, before.revision)
    assert.deepEqual(after.document, before.document)
    report.checks.push("restart-retention")
    await close()
    report.status = "passed"
  } catch (error) {
    report.status = "failed"
    // Do not serialize RPC payloads, credentials, or profile paths into evidence.
    report.failure =
      error instanceof assert.AssertionError
        ? error.message
        : "Packaged Records qualification failed; inspect the owned runtime locally."
    throw error
  } finally {
    try {
      await close()
    } catch {
      safeToRemove = false
    }
    report.cleanup = safeToRemove
      ? "owned-profile-removal-attempted"
      : "retained-for-process-safety"
    mkdirSync(dirname(reportPath), { recursive: true })
    if (safeToRemove) {
      assert(
        dirname(resolve(ownedRoot)) === resolve(tmpdir()) &&
          basename(ownedRoot).startsWith("flapstack-records-qualification-"),
      )
      try {
        rmSync(ownedRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
        report.cleanup = "removed"
      } catch {
        report.cleanup = "retained-after-cleanup-error"
      }
    }
    writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n")
    console.log(`Records qualification: ${report.status}; report ${reportPath}`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error("Packaged Records qualification failed.")
    process.exitCode = 1
  })
}
