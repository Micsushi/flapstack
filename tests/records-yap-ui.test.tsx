import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const source = (relative: string) => readFileSync(resolve(process.cwd(), relative), "utf8")

describe("canonical Yap review entry", () => {
  it("routes proposal tray entries to the shared review boundary", () => {
    const tray = source("src/renderer/features/kanban/components/task-proposal-tray.tsx")
    const shared = source("src/renderer/features/project-records/shared-records-board.tsx")
    const agents = source("src/renderer/features/agents/ui/agents-content.tsx")
    expect(tray).toContain("YAP_REVIEW_REQUEST_EVENT")
    expect(tray).toContain("Review in Yap")
    expect(tray).not.toContain("Approve exact preview")
    expect(shared).toContain("selectedProposalRef")
    expect(shared).toContain('? "yap"')
    expect(agents).toContain("YAP_REVIEW_REQUEST_EVENT")
    expect(agents).toContain('SharedRecordsBoard initialView="board"')
  })

  it("keeps source identity and accessible attachment viewing in the native tray", () => {
    const attachments = source("src/renderer/features/agents/ui/attachment-tray.tsx")
    const sharedTypes = source("src/shared/task-proposals.ts")
    expect(attachments).toContain("View source attachment")
    expect(attachments).toContain("attachment.id")
    expect(sharedTypes).toContain("YAP_REVIEW_REQUEST_EVENT")
    expect(sharedTypes).toContain("proposalIds")
  })
})
