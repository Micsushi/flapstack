import { spawn } from "node:child_process"
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { createRequire } from "node:module"
import { DatabaseSync } from "node:sqlite"
import { build } from "esbuild"

const require = createRequire(import.meta.url)
const root = resolve(import.meta.dirname, "..")
const temp = mkdtempSync(join(tmpdir(), "flapstack-usage-daemon-"))
const dbPath = join(temp, "agents.db")
const settingsPath = join(temp, "usage-settings.json")
const sourceBuildDir = mkdtempSync(join(root, ".usage-daemon-source-smoke-"))
const daemonEntry = join(sourceBuildDir, "usage-daemon-current-source.cjs")
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
  const output = { stdout: "", stderr: "" }
  child.stdout.on("data", (chunk) => {
    output.stdout += String(chunk)
  })
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
        "SELECT enabled, running, pid, last_heartbeat_at, last_poll_at, last_error FROM usage_daemon_status WHERE id = 'singleton'",
      )
      .get()
  } finally {
    check.close()
  }
}

function readDaemonBudgetAlert() {
  const check = new DatabaseSync(dbPath, { readOnly: true })
  try {
    return check
      .prepare(
        `SELECT alert_type, observed_value, threshold_value, delivery_status
         FROM usage_alert_events
         WHERE provider_id = 'flapstack-budget'
           AND account_tag = 'daemon-smoke-budget'
           AND alert_type = 'budget-soft-alert'
         ORDER BY created_at DESC
         LIMIT 1`,
      )
      .get()
  } finally {
    check.close()
  }
}

try {
  await build({
    entryPoints: [join(root, "src/main/usage-daemon.ts")],
    outfile: daemonEntry,
    bundle: true,
    packages: "external",
    platform: "node",
    format: "cjs",
    target: "node22",
    logLevel: "silent",
  })
  const db = new DatabaseSync(dbPath)
  for (const migration of readdirSync(join(root, "drizzle"))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort()) {
    db.exec(
      readFileSync(join(root, "drizzle", migration), "utf8").replaceAll(
        "--> statement-breakpoint",
        "",
      ),
    )
  }
  const nowSeconds = Math.floor(Date.now() / 1_000)
  db.prepare(
    `INSERT INTO usage_budgets (
      id, name, enabled, scope_type, provider_id, account_tag, project_id, task_id,
      automation_id, orchestration_id, threshold_type, threshold_value, action,
      reset_type, reset_timezone, version, created_at, updated_at
    ) VALUES (
      'daemon-smoke-budget', 'Daemon smoke budget', 1, 'provider-account',
      'codex', 'daemon-smoke', NULL, NULL, NULL, NULL,
      'total-tokens', 1, 'soft-alert', 'none', NULL, 1, ?, ?
    )`,
  ).run(nowSeconds, nowSeconds)
  db.prepare(
    `INSERT INTO usage_samples (
      id, provider_id, account_tag, source, cost_quality, captured_at, total_tokens,
      attribution_state, source_class, dedupe_strategy, dedupe_key, created_at
    ) VALUES (
      'daemon-smoke-sample', 'codex', 'daemon-smoke', 'external-provider',
      'exact', ?, 2, 'unknown', 'external-provider', 'exact-fact',
      'daemon-smoke-sample', ?
    )`,
  ).run(nowSeconds, nowSeconds)
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
    return (
      status?.running === 1 &&
      status?.pid === first.child.pid &&
      status?.last_poll_at != null &&
      readDaemonBudgetAlert()?.observed_value === 2
    )
  }).catch((error) => {
    throw new Error(
      `${error.message}; status=${JSON.stringify(readStatus())}; stdout=${first.output.stdout}; stderr=${first.output.stderr}`,
    )
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

  if (process.platform === "win32") {
    writeFileSync(join(temp, "usage-daemon.stop"), '{"version":1,"requestedAt":0}\n')
  } else restarted.child.kill("SIGTERM")
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
  const alert = readDaemonBudgetAlert()
  if (
    alert?.observed_value !== 2 ||
    alert?.threshold_value !== 1 ||
    alert?.delivery_status !== "sent"
  ) {
    throw new Error(`unexpected daemon budget alert: ${JSON.stringify(alert)}`)
  }
  console.log(
    "usage daemon smoke passed (closed-app alert, duplicate, crash recovery, restart, clean stop)",
  )
} finally {
  for (const child of children) {
    child.kill("SIGTERM")
  }
  await Promise.allSettled([...children].map((child) => waitForExit(child, 2_000)))
  rmSync(temp, { recursive: true, force: true })
  rmSync(sourceBuildDir, { recursive: true, force: true })
}

async function waitFor(predicate, timeoutMs = 8_000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  }
  throw new Error("timed out waiting for usage daemon heartbeat/poll")
}
