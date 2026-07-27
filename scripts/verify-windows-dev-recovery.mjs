import { spawn, spawnSync } from "node:child_process"
import { closeSync, existsSync, mkdirSync, openSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  classifyWindowsFlapstackProcesses,
  findOwnedWindowsProcessIds,
  queryWindowsProcesses,
  windowsTaskkillArgs,
} from "./lib/windows-processes.mjs"
import { resolveDevMcpDescriptorPath, resolveDevMcpProfile } from "./lib/profile-paths.mjs"

if (process.platform !== "win32") throw new Error("Dev recovery verification requires Windows")

const root = resolve(fileURLToPath(new URL("..", import.meta.url)))
const profile = resolveDevMcpProfile(process.env)
const descriptorPath = resolveDevMcpDescriptorPath(profile, {
  platform: "win32",
  env: process.env,
})
const before = JSON.parse(readFileSync(descriptorPath, "utf8"))
if (resolve(before.checkout) !== root)
  throw new Error("Live descriptor belongs to another checkout")

const proofRoot = join(tmpdir(), `flapstack-stage5-recovery-${process.pid}`)
mkdirSync(proofRoot, { recursive: true })
const sentinelReady = join(proofRoot, "unrelated-ready")
const sentinel = spawn(
  process.execPath,
  [
    "-e",
    `require("node:fs").writeFileSync(${JSON.stringify(sentinelReady)},"ready");setInterval(()=>{},1000)`,
  ],
  { cwd: tmpdir(), windowsHide: true, stdio: "ignore" },
)
const sentinelPid = sentinel.pid
if (!sentinelPid) throw new Error("Could not start unrelated-process sentinel")

try {
  const readyDeadline = Date.now() + 5_000
  while (!existsSync(sentinelReady) && Date.now() < readyDeadline) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25))
  }
  if (!existsSync(sentinelReady)) throw new Error("Unrelated-process sentinel did not start")

  const initialProcesses = queryWindowsProcesses()
  const classification = classifyWindowsFlapstackProcesses(initialProcesses, {
    root,
    profilePath: before.userDataPath,
  })
  if (classification.mainPid !== before.pid || classification.packagedPids.length > 0) {
    throw new Error(
      "Recovery proof requires one exact Dev instance and no package instance from this checkout",
    )
  }
  const ownedPids = findOwnedWindowsProcessIds(initialProcesses, {
    root,
    selfPid: process.pid,
  })
  if (!ownedPids.includes(before.pid)) {
    throw new Error(`Descriptor pid ${before.pid} is not owned by this checkout`)
  }
  for (const pid of ownedPids) {
    spawnSync("taskkill.exe", windowsTaskkillArgs(pid, true), {
      encoding: "utf8",
      windowsHide: true,
    })
  }

  const stoppedDeadline = Date.now() + 10_000
  while (
    findOwnedWindowsProcessIds(queryWindowsProcesses(), { root, selfPid: process.pid }).length >
      0 &&
    Date.now() < stoppedDeadline
  ) {
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
  }
  if (findOwnedWindowsProcessIds(queryWindowsProcesses(), { root, selfPid: process.pid }).length) {
    throw new Error("Abrupt stop left an owned process alive")
  }
  process.kill(sentinelPid, 0)

  const logPath = join(proofRoot, "restart.log")
  const logHandle = openSync(logPath, "w")
  const restartEnv = {
    ...process.env,
    FLAPSTACK_NO_FOCUS: "1",
    FLAPSTACK_START_MINIMIZED: "1",
    FLAPSTACK_WINDOW_DISPLAY: "secondary",
    FLAPSTACK_KEEP_RENDERER_ACTIVE: "1",
  }
  delete restartEnv.ELECTRON_RUN_AS_NODE
  const restart = spawn(process.execPath, ["scripts/dev.mjs"], {
    cwd: root,
    env: restartEnv,
    windowsHide: true,
    detached: true,
    stdio: ["ignore", logHandle, logHandle],
  })
  closeSync(logHandle)
  restart.unref()

  const recoveryDeadline = Date.now() + 90_000
  let after = null
  while (Date.now() < recoveryDeadline) {
    try {
      const candidate = JSON.parse(readFileSync(descriptorPath, "utf8"))
      process.kill(candidate.pid, 0)
      if (candidate.pid !== before.pid && candidate.checkout === before.checkout) {
        after = candidate
        break
      }
    } catch {
      // Descriptor removal/replacement is expected during recovery.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250))
  }
  if (!after) throw new Error(`Dev did not recover; inspect ${logPath}`)

  const verify = spawnSync(process.execPath, ["scripts/verify-dev-instance.mjs"], {
    cwd: root,
    env: restartEnv,
    encoding: "utf8",
    windowsHide: true,
    timeout: 30_000,
  })
  if (verify.status !== 0) {
    throw new Error(`Recovered instance failed identity verification: ${verify.stderr}`)
  }
  process.kill(sentinelPid, 0)
  const recoveredPids = findOwnedWindowsProcessIds(queryWindowsProcesses(), {
    root,
    selfPid: process.pid,
  })
  const recoveredMainCount = queryWindowsProcesses().filter(
    (entry) => Number(entry.ProcessId) === after.pid,
  ).length
  if (recoveredMainCount !== 1) throw new Error("Recovered primary process identity is ambiguous")

  console.log(
    JSON.stringify(
      {
        ok: true,
        checkout: root,
        profile,
        abruptStoppedPids: ownedPids,
        oldPrimaryPid: before.pid,
        recoveredPrimaryPid: after.pid,
        recoveredOwnedProcessCount: recoveredPids.length,
        unrelatedSentinelSurvived: true,
        identityVerification: verify.stdout.trim(),
      },
      null,
      2,
    ),
  )
} finally {
  try {
    sentinel.kill()
  } catch {
    // Sentinel is verification-only and may already be gone.
  }
}
