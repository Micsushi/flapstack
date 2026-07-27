const { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } = require("node:fs")
const { join } = require("node:path")

const configDir = process.env.FLAPSTACK_CONFIG_DIR
if (!configDir) process.exit(2)

mkdirSync(configDir, { recursive: true })
const readyPath = join(configDir, "live-task-ready.json")
const stoppedPath = join(configDir, "live-task-stopped.json")
const stopPath = join(configDir, "usage-daemon.stop")
writeFileSync(readyPath, `${JSON.stringify({ pid: process.pid, configDir })}\n`, "utf8")

const timer = setInterval(() => {
  if (!existsSync(stopPath)) return
  try {
    const request = JSON.parse(readFileSync(stopPath, "utf8"))
    if (request.version !== 1) return
    rmSync(stopPath, { force: true })
    writeFileSync(stoppedPath, `${JSON.stringify({ graceful: true })}\n`, "utf8")
    clearInterval(timer)
    process.exit(0)
  } catch {}
}, 25)
