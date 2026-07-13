import { runDaemon } from "./lib/usage-daemon"
import { redactUsageDiagnostic } from "./lib/usage/diagnostics"

void runDaemon().catch((error) => {
  console.error("[usage-daemon] fatal:", redactUsageDiagnostic(error))
  process.exit(1)
})
