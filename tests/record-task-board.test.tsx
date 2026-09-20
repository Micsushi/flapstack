// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"
import { SharedRecordsBoard } from "../src/renderer/features/project-records/shared-records-board"

const fixture = vi.hoisted(() => {
  const path = "projects/flapstack/features.md",
    revision = "a".repeat(64)
  const record = {
    id: "TASK-1",
    title: "Isolated work",
    kind: "task",
    state: "in_progress",
    projects: [{ id: "flapstack", name: "Flapstack" }],
    history: [],
    sourceLinks: [],
    featureIds: [],
    dependencies: [],
    workClaim: { id: "claim-1", worker: "worker" },
    workClassification: { view: "current", reason: "Fixture commitment", sourceLinks: ["fixture"] },
  }
  const snapshot = {
    path,
    revision,
    document: { schemaVersion: 1, title: "Tasks", records: [record] },
  }
  const status = {
    path,
    recordId: record.id,
    currentClaim: true,
    claim: record.workClaim,
    reasons: [],
    column: "in_progress",
    eligible: false,
  }
  return {
    path,
    revision,
    record,
    snapshot,
    status,
    open: vi.fn().mockResolvedValue({ chatId: "chat-1", worktreePath: "/isolated" }),
    utils: { chats: { invalidate: vi.fn() } },
  }
})
vi.mock("../src/renderer/lib/trpc", () => ({
  trpc: { useUtils: () => fixture.utils },
  trpcClient: {
    projectRecords: {
      openTaskChat: { mutate: fixture.open },
      boardRequest: {
        mutate: async ({ path }: { path: string }) => ({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(
            path === "/v1/session"
              ? { bearer: true }
              : path === "/v1/documents"
                ? { documents: [{ path: fixture.path, title: "Tasks" }] }
                : path.startsWith("/v1/document?")
                  ? fixture.snapshot
                  : path === "/v1/workflow"
                    ? { records: [fixture.status] }
                    : path === "/v1/agents"
                      ? { agents: [], runs: [], workspaces: {} }
                      : {},
          ),
        }),
      },
    },
  },
}))
vi.mock("../src/renderer/features/agents/atoms", async () => {
  const { atom } = await import("jotai")
  return {
    desktopViewAtom: atom<string | null>("tasks"),
    selectedProjectAtom: atom({ id: "local-id", name: "Local", path: "/local" }),
    selectedAgentChatIdAtom: atom<string | null>(null),
    openAgentChatIdsAtom: atom<string[]>([]),
    showNewChatFormAtom: atom(true),
  }
})
globalThis.IS_REACT_ACT_ENVIRONMENT = true
it("the actual shared Board forwards canonical identity and the explicit local project to the native Chat operation", async () => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true
  }
  HTMLDialogElement.prototype.close = function () {
    this.open = false
  }
  const host = document.createElement("div")
  document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () => root.render(<SharedRecordsBoard />))
    const shadow = host.querySelector("[aria-label='Project records workspace']")!.shadowRoot!
    await vi.waitFor(() => expect(shadow.textContent).toContain("Isolated work"))
    const card = Array.from(shadow.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Isolated work"),
    )!
    expect(card).toBeTruthy()
    await act(async () => card.click())
    const open = Array.from(shadow.querySelectorAll("button")).find(
      (button) => button.textContent === "Open worktree Chat",
    )!
    expect(open).toBeTruthy()
    expect(open.disabled).toBe(false)
    await act(async () => open.click())
    expect(fixture.open).toHaveBeenCalledWith({
      path: fixture.path,
      recordId: "TASK-1",
      canonicalProjectId: "flapstack",
      localProjectId: "local-id",
      expectedRevision: fixture.revision,
      claimId: "claim-1",
    })
    expect(fixture.utils.chats.invalidate).toHaveBeenCalled()
  } finally {
    await act(async () => root.unmount())
    host.remove()
  }
})
