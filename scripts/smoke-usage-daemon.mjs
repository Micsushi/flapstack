import { spawn } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { createRequire } from "node:module"
import { DatabaseSync } from "node:sqlite"

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, "..")
const temp = mkdtempSync(join(tmpdir(), "flapstack-usage-daemon-"))
const dbPath = join(temp, "agents.db")
const settingsPath = join(temp, "usage-settings.json")
const daemonEntry = join(root, "out/main/usage-daemon.js")
const electronPath = require("electron")
const children = new Set()

function spawnDaemon() {
  const child = spawn(electronPath, [daemonEntry], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      FLAPSTACK_DB_PATH: dbPath,
      FLAPSTACK_CONFIG_DIR: temp,
    },
    stdio: ["ignore", "pipe", "pipe"],
  })
  const output = { stderr: "" }
  child.stderr.on("data", (chunk) => {
    output.stderr += String(chunk)
  })
  children.add(child)
  child.once("exit", () => children.delete(child))
  return { child, output }
}

function waitForExit(child, timeoutMs = 8_000) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode })
  }
  return new Promise((resolveExit, reject) => {
    const timer = setTimeout(
      () => reject(new Error("timed out waiting for daemon exit")),
      timeoutMs,
    )
    child.once("error", reject)
    child.once("exit", (code, signal) => {
      clearTimeout(timer)
      resolveExit({ code, signal })
    })
  })
}

function readStatus() {
  const check = new DatabaseSync(dbPath, { readOnly: true })
  try {
    return check
      .prepare(
        "SELECT enabled, running, pid, last_heartbeat_at, last_poll_at FROM usage_daemon_status WHERE id = 'singleton'",
      )
      .get()
  } finally {
    check.close()
  }
}

try {
  const db = new DatabaseSync(dbPath)
  db.exec("CREATE TABLE agent_runs (id text PRIMARY KEY)")
  db.exec(
    readFileSync(join(root, "drizzle/0009_exotic_red_wolf.sql"), "utf8").replaceAll(
      "--> statement-breakpoint",
      "",
    ),
  )
  db.close()
  writeFileSync(
    settingsPath,
    JSON.stringify({ daemonEnabled: true, daemonStartAtLogin: true, cadenceSeconds: 30 }),
  )

  const first = spawnDaemon()

  await waitFor(() => {
    if (first.child.exitCode !== null || first.child.signalCode !== null) {
      throw new Error(`usage daemon exited before its first heartbeat: ${first.output.stderr}`)
    }
    const status = readStatus()
    return status?.running === 1 && status?.pid === first.child.pid && status?.last_poll_at != null
  })

  const duplicate = spawnDaemon()
  const duplicateExit = await waitForExit(duplicate.child)
  if (duplicateExit.code !== 1 || !duplicate.output.stderr.includes("already running")) {
    throw new Error(
      `duplicate daemon did not fail closed: ${JSON.stringify(duplicateExit)} ${duplicate.output.stderr}`,
    )
  }

  first.child.kill("SIGKILL")
  await waitForExit(first.child)

  const restarted = spawnDaemon()
  await waitFor(() => {
    if (restarted.child.exitCode !== null || restarted.child.signalCode !== null) {
      throw new Error(`restarted daemon exited before recovery: ${restarted.output.stderr}`)
    }
    const status = readStatus()
    return status?.running === 1 && status?.pid === restarted.child.pid
  })

  restarted.child.kill("SIGTERM")
  const restartedExit = await waitForExit(restarted.child)
  if (restartedExit.code !== 0) {
    throw new Error(`restarted daemon exited ${restartedExit.code}: ${restarted.output.stderr}`)
  }

  const status = readStatus()
  if (
    status?.enabled !== 1 ||
    status?.running !== 0 ||
    status?.pid != null ||
    status?.last_poll_at == null
  ) {
    throw new Error(`unexpected final daemon status: ${JSON.stringify(status)}`)
  }
  console.log("usage daemon smoke passed (duplicate, crash recovery, restart, clean stop)")
} finally {
  for (const child of children) {
    child.kill("SIGTERM")
  }
  await Promise.allSettled([...children].map((child) => waitForExit(child, 2_000)))
  rmSync(temp, { recursive: true, force: true })
}

async function waitFor(predicate, timeoutMs = 8_000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  }
  throw new Error("timed out waiting for usage daemon heartbeat/poll")
}
