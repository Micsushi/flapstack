import { runDaemon } from "./lib/usage-daemon"

void runDaemon().catch((error) => {
  console.error("[usage-daemon] fatal:", error)
  process.exit(1)
})
