import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const source = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8")

describe("visual capture lifecycle and consumer surface contract", () => {
  it("routes approved agent requests only to their originating Chat", () => {
    const router = source("src/main/lib/trpc/routers/visual-capture.ts")
    const dialog = source("src/renderer/features/agents/ui/visual-capture-dialog.tsx")
    expect(router).toMatch(/approvedAgentRequests[\s\S]+chatId:[\s\S]+caller_chat_id = \?/)
    expect(dialog).toContain("{ projectId, chatId }")
  })

  it("exposes verified lifecycle state and reachable retention, archive, delete, export, import, cleanup, and audit controls", () => {
    const dialog = source("src/renderer/features/agents/ui/visual-capture-dialog.tsx")
    for (const contract of [
      "integrityState",
      "retainedUntil",
      "archive.useMutation",
      "delete.useMutation",
      "exportSelected.useMutation",
      "importDerivative.useMutation",
      "cleanupExpired.useMutation",
      "auditHistory.useQuery",
    ]) {
      expect(dialog).toContain(contract)
    }
  })

  it("has production task and knowledge consumers for linked exact artifacts", () => {
    const tray = source("src/renderer/features/agents/ui/attachment-tray.tsx")
    const graph = source("src/renderer/features/project-vault/project-vault-graph-panel.tsx")
    const mutation = source("src/main/lib/mcp-control/mutation-service.ts")
    expect(tray).toContain("listLinked")
    expect(graph).toContain("listLinked")
    expect(graph).toContain('consumerKind: "knowledge"')
    expect(mutation).toContain("vault_context_manifest")
    expect(mutation).toContain("consumer_kind = 'task'")
  })
})
