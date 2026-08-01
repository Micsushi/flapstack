import { describe, expect, it, vi } from "vitest"
import {
  WorkbenchWindowSessionStore,
  clampWorkbenchWindowBounds,
  type WorkbenchWindowSessionStorage,
} from "../src/main/windows/workbench-window-budget"
import {
  createChatWorkbenchLayout,
  chatWorkbenchWindowSessionSchema,
} from "../src/shared/chat-workbench"
import {
  chatWorkbenchToSavedWorkspace,
  savedWorkspaceToChatWorkbench,
} from "../src/shared/workbench-saved-workspace-adapter"
import {
  SwarmGroupControl,
  type SwarmControlTarget,
} from "../src/main/lib/agent-orchestration/swarm-group-control"
import { executeChatTransferDestinationAction } from "../src/renderer/lib/chat-transfer-window-limit"

function memoryStorage(initial: unknown): WorkbenchWindowSessionStorage & {
  serialized: () => string | null
} {
  let value = initial === null ? null : JSON.stringify(initial)
  let backup: string | null = null
  return {
    read: () => value,
    readBackup: () => backup,
    write: (next) => {
      backup = value
      value = next
    },
    serialized: () => value,
  }
}

describe("Stage 6 workbench session persistence", () => {
  it("persists stable layout state and opaque draft/scroll references without content", () => {
    const storage = memoryStorage(null)
    const store = new WorkbenchWindowSessionStore(storage, { now: () => 20 })
    store.upsert({
      stableId: "main",
      kind: "main",
      lastFocusedAt: 20,
      launch: { projectId: "project-a" },
      displayId: "display-1",
      bounds: { x: 10, y: 20, width: 1_200, height: 800 },
      compact: true,
      layout: createChatWorkbenchLayout(["chat-a", "chat-b"], "chat-b"),
      draftRefs: { "chat-a": "draft:chat-a" },
      scrollAnchorRefs: { "chat-b": "anchor:chat-b" },
    })

    const serialized = storage.serialized()!
    expect(serialized).toContain('"version":2')
    expect(serialized).toContain('"draft:chat-a"')
    expect(serialized).not.toMatch(/message|prompt|transcript|secret draft/i)
    expect(new WorkbenchWindowSessionStore(storage).inspect()).toMatchObject({
      status: "ready",
      windows: [
        {
          stableId: "main",
          displayId: "display-1",
          compact: true,
          draftRefs: { "chat-a": "draft:chat-a" },
          scrollAnchorRefs: { "chat-b": "anchor:chat-b" },
        },
      ],
    })
  })

  it("migrates v1 launch records and isolates a corrupt sibling window", () => {
    const storage = memoryStorage({
      version: 1,
      windows: [
        { stableId: "main", lastFocusedAt: 2, launch: { chatId: "chat-a" } },
        { stableId: "", lastFocusedAt: "broken", launch: { transcript: "private" } },
      ],
    })
    const store = new WorkbenchWindowSessionStore(storage)

    expect(store.inspect()).toMatchObject({
      status: "ready",
      windows: [
        {
          stableId: "main",
          kind: "main",
          layout: { activeGroupId: "chat-group-1" },
        },
      ],
      isolatedCount: 1,
    })
    expect(store.exportSnapshot()).not.toContain("private")
  })

  it("imports valid windows independently and preserves dormant overflow", () => {
    const store = new WorkbenchWindowSessionStore(memoryStorage(null))
    const windows = Array.from({ length: 6 }, (_, index) => ({
      stableId: index === 0 ? "main" : `window-${index}`,
      kind: index === 0 ? ("main" as const) : ("chat" as const),
      lastFocusedAt: index,
      launch: { chatId: `chat-${index}` },
      layout: createChatWorkbenchLayout([`chat-${index}`]),
      draftRefs: {},
      scrollAnchorRefs: {},
    }))
    expect(store.importSnapshot(JSON.stringify({ version: 2, windows }))).toMatchObject({
      imported: 6,
      isolated: 0,
    })
    expect(store.selectForStartup().active.map((entry) => entry.stableId)).toEqual([
      "main",
      "window-5",
      "window-4",
      "window-3",
    ])
    expect(store.selectForStartup().dormant.map((entry) => entry.stableId)).toEqual([
      "window-2",
      "window-1",
    ])
  })

  it("keeps restored layout references when main refreshes launch geometry", () => {
    const storage = memoryStorage(null)
    const store = new WorkbenchWindowSessionStore(storage)
    const layout = createChatWorkbenchLayout(["chat-a", "chat-b"], "chat-b")
    store.upsert({
      stableId: "main",
      kind: "main",
      lastFocusedAt: 1,
      launch: { projectId: "project-a" },
      layout,
      draftRefs: { "chat-a": "draft:chat-a" },
      scrollAnchorRefs: { "chat-b": "anchor:chat-b" },
    })
    store.upsert({
      stableId: "main",
      kind: "main",
      lastFocusedAt: 2,
      launch: { projectId: "project-a" },
      bounds: { x: 20, y: 30, width: 1_000, height: 700 },
    })

    expect(store.inspect()).toMatchObject({
      windows: [
        {
          layout,
          draftRefs: { "chat-a": "draft:chat-a" },
          scrollAnchorRefs: { "chat-b": "anchor:chat-b" },
        },
      ],
    })
  })

  it("updates renderer presentation independently without replacing launch identity", () => {
    const store = new WorkbenchWindowSessionStore(memoryStorage(null))
    store.upsert({
      stableId: "main",
      kind: "main",
      lastFocusedAt: 1,
      launch: { projectId: "project-a", chatId: "chat-a" },
    })
    const layout = createChatWorkbenchLayout(["chat-a", "chat-b"], "chat-b")

    expect(
      store.updatePresentation("main", {
        layout,
        compact: true,
        draftRefs: { "chat-a": "draft:main:chat-a" },
        scrollAnchorRefs: { "chat-b": "anchor:main:chat-b" },
      }),
    ).toBe(true)
    expect(store.inspect()).toMatchObject({
      windows: [
        {
          launch: { projectId: "project-a", chatId: "chat-a" },
          layout,
          compact: true,
          draftRefs: { "chat-a": "draft:main:chat-a" },
          scrollAnchorRefs: { "chat-b": "anchor:main:chat-b" },
        },
      ],
    })
  })

  it("accepts the first renderer presentation before deferred window metadata arrives", () => {
    const store = new WorkbenchWindowSessionStore(memoryStorage(null), { now: () => 10 })
    const layout = createChatWorkbenchLayout(["chat-a"])

    expect(
      store.updatePresentation("main", {
        layout,
        compact: false,
        draftRefs: {},
        scrollAnchorRefs: {},
      }),
    ).toBe(true)
    expect(store.get("main")).toMatchObject({
      stableId: "main",
      kind: "main",
      lastFocusedAt: 10,
      launch: {},
      layout,
    })
  })

  it("clamps missing-display bounds to the nearest available work area", () => {
    expect(
      clampWorkbenchWindowBounds(
        {
          displayId: "removed-display",
          bounds: { x: 4_000, y: 1_000, width: 1_400, height: 900 },
        },
        [{ id: "primary", workArea: { x: 0, y: 0, width: 1_920, height: 1_080 } }],
      ),
    ).toEqual({
      displayId: "primary",
      bounds: { x: 520, y: 180, width: 1_400, height: 900 },
    })
  })

  it("promotes and imports Chat layouts by durable identity only", () => {
    const workbench = createChatWorkbenchLayout(["chat-a", "chat-b"], "chat-b")
    const workspace = chatWorkbenchToSavedWorkspace(workbench)
    expect(JSON.stringify(workspace)).not.toMatch(/messages|runs|terminalProcess/)
    expect(savedWorkspaceToChatWorkbench(workspace)).toEqual(workbench)
  })

  it("rejects persisted draft content while accepting opaque references", () => {
    const base = {
      version: 1,
      stableWindowId: "main",
      kind: "main",
      projectId: null,
      layout: createChatWorkbenchLayout(["chat-a"]),
      lastFocusedAt: 1,
      draftRefs: { "chat-a": "draft:chat-a" },
      transcriptAnchorRefs: { "chat-a": "anchor:chat-a" },
    }
    expect(chatWorkbenchWindowSessionSchema.safeParse(base).success).toBe(true)
    expect(
      chatWorkbenchWindowSessionSchema.safeParse({
        ...base,
        drafts: { "chat-a": "secret draft text" },
      }).success,
    ).toBe(false)
  })
})

function target(agentId: string, options?: Partial<SwarmControlTarget>): SwarmControlTarget {
  return {
    agentId,
    runId: `run-${agentId}`,
    version: 1,
    status: "running",
    capabilities: ["pause", "resume", "cancel", "steer"],
    permissions: ["control", "steer"],
    ...options,
  }
}

describe("Stage 6 exact-selection swarm controls", () => {
  it("rejects a stale exact selection before authority or provider mutation", async () => {
    const mutate = vi.fn()
    const audit = vi.fn()
    const control = new SwarmGroupControl({
      approve: vi.fn().mockResolvedValue("approval-1"),
      cascade: mutate,
      steer: mutate,
      audit,
    })
    const preview = control.preview("pause", [target("a"), target("b")], ["b", "a"])

    await expect(
      control.execute(preview, [target("a"), target("b", { version: 2 })]),
    ).resolves.toMatchObject({ status: "stale-selection", results: [] })
    expect(mutate).not.toHaveBeenCalled()
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "stale-selection", selectionVersion: preview.version }),
    )
  })

  it("rejects client-tampered target rows before authority or provider mutation", async () => {
    const mutate = vi.fn()
    const approve = vi.fn().mockResolvedValue("approval-1")
    const audit = vi.fn()
    const control = new SwarmGroupControl({
      approve,
      cascade: mutate,
      steer: mutate,
      audit,
    })
    const targets = [target("a"), target("b")]
    const preview = control.preview("cancel", targets, ["a"])
    const tampered = {
      ...preview,
      targets: [
        {
          ...preview.targets[0],
          agentId: "b",
          runId: "run-b",
        },
      ],
    }

    await expect(control.execute(tampered, targets)).resolves.toMatchObject({
      status: "stale-selection",
      results: [],
    })
    expect(approve).not.toHaveBeenCalled()
    expect(mutate).not.toHaveBeenCalled()
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "stale-selection", selectionVersion: preview.version }),
    )
  })

  it("intersects capability and permission, approves once, and audits partial results", async () => {
    const approve = vi.fn().mockResolvedValue("approval-1")
    const cascade = vi
      .fn()
      .mockResolvedValueOnce({ acknowledged: true })
      .mockRejectedValueOnce(new Error("runtime unavailable"))
    const audit = vi.fn()
    const control = new SwarmGroupControl({
      approve,
      cascade,
      steer: vi.fn(),
      audit,
    })
    const targets = [target("a"), target("b"), target("c", { permissions: ["steer"] })]
    const preview = control.preview("cancel", targets, ["c", "b", "a"])

    expect(preview.selection).toEqual(["a", "b", "c"])
    expect(preview.targets).toEqual([
      expect.objectContaining({ agentId: "a", supported: true }),
      expect.objectContaining({ agentId: "b", supported: true }),
      expect.objectContaining({
        agentId: "c",
        supported: false,
        reason: "permission-denied",
      }),
    ])
    expect(preview.permissionIntersection).toEqual(["steer"])

    await expect(control.execute(preview, targets)).resolves.toMatchObject({
      status: "partial",
      approvalAuditId: "approval-1",
      results: [
        { agentId: "a", outcome: "succeeded" },
        { agentId: "b", outcome: "failed", detail: "runtime unavailable" },
        { agentId: "c", outcome: "unchanged", detail: "permission-denied" },
      ],
    })
    expect(approve).toHaveBeenCalledOnce()
    expect(cascade).toHaveBeenCalledTimes(2)
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "c",
        runId: "run-c",
        outcome: "unchanged",
        approvalAuditId: "approval-1",
      }),
    )
  })
})

describe("Stage 6 existing-window transfer chooser", () => {
  it("wires split/add-as-tab/focus/cancel without changing ownership before destination commit", async () => {
    let owner = "main"
    const startChatTransfer = vi.fn().mockResolvedValue({
      status: "started",
      transfer: { nonce: "opaque-nonce-1" },
    })
    const reserveChatTransfer = vi.fn().mockImplementation(async (input) => {
      expect(owner).toBe("main")
      return { status: "reserved", destination: input }
    })
    const focusStableWindow = vi.fn().mockResolvedValue("focused")
    const api = { startChatTransfer, reserveChatTransfer, focusStableWindow }
    const context = {
      chatId: "chat-a",
      sourceWindowId: "main",
      sourceGroupId: "group-a",
      operation: "move" as const,
    }
    const destination = {
      stableId: "window-2",
      label: "Window 2",
      groupId: "destination-group-3",
    }

    await expect(
      executeChatTransferDestinationAction(api, context, destination, "split-right"),
    ).resolves.toMatchObject({ status: "reserved" })
    expect(reserveChatTransfer).toHaveBeenLastCalledWith(
      expect.objectContaining({
        destinationWindowId: "window-2",
        destinationGroupId: "destination-group-3",
        zone: "right",
      }),
    )
    expect(owner).toBe("main")

    await executeChatTransferDestinationAction(api, context, destination, "add-as-tab")
    expect(reserveChatTransfer).toHaveBeenLastCalledWith(
      expect.objectContaining({
        destinationWindowId: "window-2",
        destinationGroupId: "destination-group-3",
        zone: "tab",
      }),
    )
    expect(owner).toBe("main")

    await expect(
      executeChatTransferDestinationAction(api, context, destination, "focus"),
    ).resolves.toEqual({ status: "focused" })
    expect(focusStableWindow).toHaveBeenCalledWith("window-2")
    await expect(
      executeChatTransferDestinationAction(api, context, destination, "cancel"),
    ).resolves.toEqual({ status: "cancelled" })
    expect(owner).toBe("main")
    owner = "window-2"
  })
})
