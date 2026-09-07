import { app, powerMonitor, powerSaveBlocker } from "electron"
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { randomUUID } from "node:crypto"
import {
  SLEEP_PREVENTION_MODES,
  type SleepPreventionMode,
  type SleepPreventionStatus,
} from "../../../shared/sleep-prevention"
import { SleepPreventionController } from "./controller"
import { createSleepAssertionStarter } from "./native"

let controller: SleepPreventionController | null = null
let timer: ReturnType<typeof setInterval> | null = null
let configError: string | null = null
const refresh = () => controller?.refresh()

export function initializeSleepPrevention(
  readWork: () => { agentWork: boolean; terminals: number },
): void {
  if (controller) return
  const path = join(app.getPath("userData"), "data", "sleep-prevention.json")
  let mode: SleepPreventionMode = "off"
  try {
    const value = JSON.parse(readFileSync(path, "utf8"))
    if (!SLEEP_PREVENTION_MODES.includes(value.mode)) throw new Error("Invalid mode")
    mode = value.mode
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      configError = "Could not read the saved sleep preference. Select a mode to save it again."
    }
  }
  controller = new SleepPreventionController({
    mode,
    readWork,
    start: createSleepAssertionStarter({
      platform: process.platform,
      processId: process.pid,
      blocker: powerSaveBlocker,
    }),
    persist(next) {
      mkdirSync(dirname(path), { recursive: true })
      const temporary = `${path}.${randomUUID()}.tmp`
      try {
        writeFileSync(temporary, JSON.stringify({ mode: next }), { mode: 0o600, flag: "wx" })
        renameSync(temporary, path)
        configError = null
      } finally {
        try {
          unlinkSync(temporary)
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            console.warn("[Sleep prevention] Could not remove temporary settings file")
          }
        }
      }
    },
  })
  refresh()
  timer = setInterval(refresh, 5_000)
  timer.unref()
  powerMonitor.on("resume", refresh)
}

export function getSleepPreventionStatus(): SleepPreventionStatus {
  const status = controller?.status() ?? {
    mode: "off",
    active: false,
    agentWork: false,
    terminals: 0,
    error: "Sleep prevention is unavailable in this session.",
  }
  return { ...status, error: status.error ?? configError }
}

export function setSleepPreventionMode(mode: SleepPreventionMode): SleepPreventionStatus {
  if (!controller) throw new Error("Sleep prevention is unavailable in this session")
  controller.setMode(mode)
  return getSleepPreventionStatus()
}

export function stopSleepPrevention(): void {
  if (timer) clearInterval(timer)
  timer = null
  powerMonitor.removeListener("resume", refresh)
  controller?.dispose()
}
