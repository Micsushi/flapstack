import { describe, expect, it } from "vitest"
import { createAgentActivityStore } from "../src/main/lib/agent-runtime/activity-store"
import { sanitizeClaudeDiagnostic } from "../src/main/lib/agent-runtime/claude-code"
import { sanitizeRuntimeDiagnostic } from "../src/main/lib/agent-runtime/diagnostics"
import { sanitizeRuntimeText, sanitizeRuntimeValue } from "../src/main/lib/agent-runtime/sanitizer"
import { createActivityTestDatabase, seedRuntimeRun } from "./agent-activity-test-db"

const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzZWNyZXQifQ.signature"

describe("Runtime persisted/display diagnostic sanitizer", () => {
  it("redacts provider errors, lifecycle detail, stderr, nested fields, and diagnostics", () => {
    const adversarial =
      `stderr Bearer secret-token ${JWT} API_KEY=abcd /Users/alice/private/project ` +
      "-----BEGIN PRIVATE KEY-----hidden-----END PRIVATE KEY-----"
    for (const value of [
      sanitizeRuntimeText(adversarial),
      sanitizeClaudeDiagnostic(adversarial),
      sanitizeRuntimeDiagnostic(new Error(adversarial)),
      JSON.stringify(
        sanitizeRuntimeValue({ nested: { accessToken: "token-value", detail: adversarial } }),
      ),
    ]) {
      expect(value).not.toContain("secret-token")
      expect(value).not.toContain(JWT)
      expect(value).not.toContain("abcd")
      expect(value).not.toContain("/Users/alice")
      expect(value).not.toContain("hidden")
    }
  })

  it("sanitizes ordinary persisted payloads and export while preserving explicit agent paths", () => {
    const database = createActivityTestDatabase()
    const { runId } = seedRuntimeRun(database)
    const store = createAgentActivityStore(database, { now: () => 1_780_000_000_000 })
    try {
      store.appendBatch(runId, [
        {
          provider: "openai",
          kind: "warning",
          phase: "failed",
          displayClass: "status",
          privacyClass: "sensitive",
          payload: {
            message: `Bearer secret-warning from /Users/alice/private stderr ${JWT}`,
            code: "provider-error",
          },
          dedupKey: "warning-secret-warning-/Users/alice/private",
        },
        {
          provider: "openai",
          kind: "lifecycle",
          phase: "failed",
          displayClass: "status",
          privacyClass: "sensitive",
          payload: {
            state: "failed",
            detail: "password=hunter2 at /home/alice/work",
          },
          dedupKey: "lifecycle-failed",
        },
        {
          provider: "openai",
          kind: "agent-text",
          phase: "completed",
          displayClass: "summary",
          privacyClass: "public",
          payload: { text: "Edited /Users/alice/project/file.ts using sk-secretvalue" },
          dedupKey: "agent-text",
        },
      ])

      const raw = JSON.stringify(
        database
          .prepare("SELECT dedup_key, payload_json FROM agent_activity_events ORDER BY sequence")
          .all(),
      )
      expect(raw).not.toContain("secret-warning")
      expect(raw).not.toContain("hunter2")
      expect(raw).not.toContain(JWT)
      expect(raw).not.toContain("/home/alice")
      expect(raw).toContain("Edited /Users/alice/project/file.ts")
      expect(raw).not.toContain("sk-secretvalue")

      const exported = JSON.stringify(store.export({ runId, limit: 500, direction: "forward" }))
      expect(exported).not.toContain("secret-warning")
      expect(exported).not.toContain("hunter2")
      expect(exported).not.toContain("sk-secretvalue")
    } finally {
      database.close()
    }
  })
})
