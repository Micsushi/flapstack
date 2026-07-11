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
let child

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

  child = spawn(electronPath, [daemonEntry], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      FLAPSTACK_DB_PATH: dbPath,
      FLAPSTACK_CONFIG_DIR: temp,
    },
    stdio: ["ignore", "pipe", "pipe"],
  })
  let stderr = ""
  let earlyExit = null
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk)
  })
  child.once("exit", (code, signal) => {
    earlyExit = new Error(
      `usage daemon exited before its first heartbeat (code=${code}, signal=${signal}): ${stderr}`,
    )
  })
  child.once("error", (error) => {
    earlyExit = error
  })

  await waitFor(() => {
    if (earlyExit) throw earlyExit
    const check = new DatabaseSync(dbPath, { readOnly: true })
    try {
      const status = check
        .prepare("SELECT running, last_poll_at FROM usage_daemon_status WHERE id = 'singleton'")
        .get()
      return status?.running === 1 && status?.last_poll_at != null
    } finally {
      check.close()
    }
  })

  child.kill("SIGTERM")
  const exitCode = await new Promise((resolveExit, reject) => {
    child.once("error", reject)
    child.once("exit", resolveExit)
  })
  if (exitCode !== 0) throw new Error(`daemon exited ${exitCode}: ${stderr}`)

  const check = new DatabaseSync(dbPath, { readOnly: true })
  const status = check
    .prepare("SELECT enabled, running, last_heartbeat_at, last_poll_at FROM usage_daemon_status")
    .get()
  check.close()
  if (status?.enabled !== 1 || status?.running !== 0 || status?.last_poll_at == null) {
    throw new Error(`unexpected final daemon status: ${JSON.stringify(status)}`)
  }
  console.log("usage daemon smoke passed")
} finally {
  if (child?.exitCode === null && child?.signalCode === null) {
    child.kill("SIGTERM")
    await Promise.race([
      new Promise((resolveExit) => child.once("exit", resolveExit)),
      new Promise((resolveTimeout) => setTimeout(resolveTimeout, 2_000)),
    ])
  }
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
