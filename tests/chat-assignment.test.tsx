// @vitest-environment jsdom
import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { readFileSync } from "node:fs"
import { hostname } from "node:os"
import { resolve } from "node:path"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import * as schema from "../src/main/lib/db/schema"
import { migrateDatabase } from "../src/main/lib/db/migrate"
import {
  assertChatAssignmentProjectMove,
  getChatAssignment,
  updateChatAssignment,
} from "../src/main/lib/chat-assignment"
import { discussionHostId } from "../src/main/lib/discussions/service"
import { ChatTitleEditor } from "../src/renderer/features/agents/ui/chat-title-editor"
import { ChatAssignmentControl } from "../src/renderer/features/agents/ui/chat-assignment-control"
import {
  clearAppActionHistory,
  getAppActionHistorySnapshot,
  redoAppAction,
  undoAppAction,
} from "../src/renderer/lib/app-action-history"
import type { ChatAssignment } from "../src/shared/chat-assignment"

const api = vi.hoisted(() => ({
  read: (_input: { subChatId: string }): unknown => undefined,
  write: (_input: unknown): unknown => undefined,
}))
vi.mock("../src/renderer/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ chats: { getAssignment: { invalidate: async () => undefined } } }),
    chats: {
      getAssignment: { useQuery: (input: { subChatId: string }) => ({ data: api.read(input) }) },
    },
  },
  trpcClient: {
    chats: { updateAssignment: { mutate: async (input: unknown) => api.write(input) } },
  },
}))
vi.mock("../src/renderer/components/progressive-overflow-row", () => ({
  ProgressiveOverflowRow: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const empty: ChatAssignment = { assignedRole: null, leadChatId: null, discussionChatId: null }
let db: Database.Database
const read = (id = "worker") => getChatAssignment(db, `${id}-pane`)
const change = (id: string, assignment: ChatAssignment, expected = read(id).assignment) =>
  updateChatAssignment(db, { subChatId: `${id}-pane`, expected, assignment })

beforeEach(() => {
  db = new Database(":memory:")
  const database = drizzle(db, { schema })
  migrateDatabase(database, db, resolve("drizzle"))
  database
    .insert(schema.projects)
    .values([
      { id: "p", name: "Project", path: "/project" },
      { id: "other", name: "Other", path: "/other" },
    ])
    .run()
  for (const [id, projectId] of [
    ["discussion", "p"],
    ["lead", "p"],
    ["worker", "p"],
    ["foreign", "other"],
    ["global", null],
  ] as const) {
    database.insert(schema.chats).values({ id, projectId, name: id }).run()
    database
      .insert(schema.subChats)
      .values({ id: `${id}-pane`, chatId: id })
      .run()
  }
  change("discussion", { ...empty, assignedRole: "discussion" })
  change("lead", { ...empty, assignedRole: "lead", discussionChatId: "discussion" })
  api.read = ({ subChatId }) => getChatAssignment(db, subChatId)
  api.write = (input) => updateChatAssignment(db, input)
  clearAppActionHistory()
})
afterEach(() => {
  db.close()
  document.body.replaceChildren()
  clearAppActionHistory()
})

describe("owner chat assignment", () => {
  it("resolves the pane, persists independent links, and supplies existing local host identity", () => {
    change("worker", { assignedRole: "worker", leadChatId: "lead", discussionChatId: "discussion" })
    expect(read()).toMatchObject({
      chatId: "worker",
      assignment: { assignedRole: "worker", leadChatId: "lead", discussionChatId: "discussion" },
      localHost: { id: discussionHostId(), label: hostname() },
    })
    expect(read().choices.map((chat) => chat.id)).not.toContain("foreign")
    expect(() => getChatAssignment(db, "worker")).toThrow("pane not found")
    expect(() =>
      updateChatAssignment(db, {
        subChatId: "worker-pane",
        expected: read().assignment,
        assignment: empty,
        localHost: "spoof",
      }),
    ).toThrow()
    expect(db.prepare("SELECT COUNT(*) AS count FROM chat_agent_labels").get()).toEqual({
      count: 0,
    })
  })

  it("rejects foreign project, inferred or wrong target roles, self links and invalid source roles", () => {
    const worker = { ...empty, assignedRole: "worker" as const }
    change("foreign", { ...empty, assignedRole: "lead" })
    expect(() => change("worker", { ...worker, leadChatId: "foreign" })).toThrow("same project")
    expect(() => change("worker", { ...worker, leadChatId: "discussion" })).toThrow(
      "owner-assigned lead",
    )
    expect(() => change("worker", { ...worker, leadChatId: "worker" })).toThrow("itself")
    expect(() => change("worker", { ...empty, leadChatId: "lead" })).toThrow("Only a worker")
    expect(() => change("global", { ...worker, leadChatId: "lead" })).toThrow("same project")
    expect(() => change("worker", { ...worker, discussionChatId: "lead" })).toThrow(
      "owner-assigned discussion",
    )
  })

  it("keeps incoming roles and project scope valid, while allowing same-project moves", () => {
    change("worker", { ...empty, assignedRole: "worker", leadChatId: "lead" })
    expect(() => change("lead", empty)).toThrow("incoming chat links")
    expect(() => assertChatAssignmentProjectMove(db, "lead", "other")).toThrow(
      "Remove chat assignment links",
    )
    expect(() => assertChatAssignmentProjectMove(db, "worker", null)).toThrow(
      "Remove chat assignment links",
    )
    expect(() => assertChatAssignmentProjectMove(db, "worker", "p")).not.toThrow()
    change("worker", empty)
    change("lead", empty)
    expect(() => assertChatAssignmentProjectMove(db, "lead", "other")).not.toThrow()
  })

  it("never treats automatic labels as owner assignments", () => {
    change("lead", empty)
    drizzle(db, { schema })
      .insert(schema.chatAgentLabels)
      .values({
        chatId: "lead",
        key: "coordinator",
        confidence: 100,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run()
    expect(() =>
      change("worker", { ...empty, assignedRole: "worker", leadChatId: "lead" }),
    ).toThrow("owner-assigned lead")
    expect(read("lead").assignment).toEqual(empty)
  })

  it("rejects stale edits and clears a deleted target without deleting the worker", () => {
    const prior = read().assignment
    change("worker", { ...empty, assignedRole: "worker", leadChatId: "lead" })
    expect(() => change("worker", empty, prior)).toThrow("changed elsewhere")
    db.prepare("DELETE FROM chats WHERE id = ?").run("lead")
    expect(read().assignment).toEqual({ ...empty, assignedRole: "worker" })
  })

  it("0069 preserves pre-existing chat data and adds nullable assignments", () => {
    const old = new Database(":memory:")
    try {
      old.exec(
        "CREATE TABLE chats (id text PRIMARY KEY, name text, permission_mode text); INSERT INTO chats VALUES ('existing', 'Keep me', 'read-only')",
      )
      old.exec(
        readFileSync(resolve("drizzle/0069_chat_assignments.sql"), "utf8").replaceAll(
          "--> statement-breakpoint",
          "",
        ),
      )
      expect(old.prepare("SELECT * FROM chats").get()).toEqual({
        id: "existing",
        name: "Keep me",
        permission_mode: "read-only",
        assigned_role: null,
        lead_chat_id: null,
        discussion_chat_id: null,
      })
    } finally {
      old.close()
    }
  })

  it("discards an open draft when switching to another equally unassigned pane", async () => {
    const container = document.createElement("div")
    document.body.append(container)
    const root = createRoot(container)
    await act(async () =>
      root.render(
        <ChatTitleEditor name="Worker" chatId="worker-pane" onSave={async () => undefined} />,
      ),
    )
    await act(async () => container.querySelector("button")!.click())
    await act(async () => {
      const select = document.querySelector("select")!
      select.value = "worker"
      select.dispatchEvent(new Event("change", { bubbles: true }))
    })
    expect(document.querySelector("select")!.value).toBe("worker")
    // Both parent chats start unassigned, so a stale expected value would pass CAS.
    await act(async () =>
      root.render(
        <ChatTitleEditor name="Foreign" chatId="foreign-pane" onSave={async () => undefined} />,
      ),
    )
    expect(document.querySelector("select")).toBeNull()
    expect(read("worker").assignment).toEqual(empty)
    expect(read("foreign").assignment).toEqual(empty)
    await act(async () => container.querySelector("button")!.click())
    expect(document.querySelector("select")!.value).toBe("")
    expect(
      Array.from(document.querySelectorAll("button")).find(
        (button) => button.textContent === "Save assignment",
      )!.disabled,
    ).toBe(true)
    expect(getAppActionHistorySnapshot().canUndo).toBe(false)
    await act(async () => root.unmount())
  })

  it("saves from the actual control and applies shared undo/redo without inferring a role", async () => {
    const container = document.createElement("div")
    document.body.append(container)
    const root = createRoot(container)
    await act(async () => root.render(<ChatAssignmentControl subChatId="worker-pane" />))
    expect(container.textContent).toContain("Assign role")
    await act(async () => container.querySelector("button")!.click())
    expect(document.body.textContent).toContain(`Local host: ${hostname()}`)
    const setSelect = async (index: number, value: string) =>
      act(async () => {
        const select = document.querySelectorAll("select")[index]!
        select.value = value
        select.dispatchEvent(new Event("change", { bubbles: true }))
      })
    await setSelect(0, "worker")
    await setSelect(1, "lead")
    await setSelect(2, "discussion")
    const save = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "Save assignment",
    )!
    await act(async () => save.click())
    expect(read().assignment).toEqual({
      assignedRole: "worker",
      leadChatId: "lead",
      discussionChatId: "discussion",
    })
    expect(container.textContent).toContain("Assigned worker")
    await act(async () => {
      await undoAppAction()
    })
    expect(read().assignment).toEqual(empty)
    await act(async () => {
      await redoAppAction()
    })
    expect(read().assignment.leadChatId).toBe("lead")
    change("worker", { ...empty, assignedRole: "worker" })
    await expect(undoAppAction()).rejects.toThrow("changed elsewhere")
    expect(getAppActionHistorySnapshot().canUndo).toBe(true)
    await act(async () => root.unmount())
  })
})
