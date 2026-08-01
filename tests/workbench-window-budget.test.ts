import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import {
  MAX_WORKBENCH_WINDOWS,
  WindowBudget,
  WorkbenchWindowSessionCorruptError,
  WorkbenchWindowSessionStore,
  cleanupFailedWorkbenchWindowCreation,
  createFileWorkbenchWindowSessionStorage,
  createWorkbenchWindowCreationFailure,
  type WorkbenchWindowReservationResult,
  type WorkbenchWindowSessionStorage,
} from "../src/main/windows/workbench-window-budget"
import {
  asWorkbenchWindowCreationFailure,
  describeWorkbenchWindowCreationFailure,
  usableWorkbenchWindowDestinations,
} from "../src/renderer/lib/workbench-window-limit"

function fakeClock(start = 1_000) {
  let current = start
  return {
    now: () => current,
    advance: (milliseconds: number) => {
      current += milliseconds
    },
  }
}

function reserveWorkbench(budget: WindowBudget, requestedStableId?: string) {
  return budget.reserve({ classification: "workbench", requestedStableId })
}

function reservationId(result: WorkbenchWindowReservationResult): string {
  if (result.status !== "available" || !result.reservationId) {
    throw new Error(`Expected a counted reservation, received ${result.status}.`)
  }
  return result.reservationId
}

describe("Stage 6 workbench window budget", () => {
  it("atomically reserves main plus three auxiliaries and rejects every fifth race", () => {
    const clock = fakeClock()
    const budget = new WindowBudget({ now: clock.now, reservationTtlMs: 1_000 })
    const attempts = Array.from({ length: 12 }, (_, index) =>
      reserveWorkbench(budget, index === 0 ? "main" : `window-${index + 1}`),
    )

    expect(MAX_WORKBENCH_WINDOWS).toBe(4)
    expect(attempts.filter((result) => result.status === "available")).toHaveLength(4)
    expect(attempts.filter((result) => result.status === "at-limit")).toHaveLength(8)
    expect(budget.inspect()).toMatchObject({
      status: "at-limit",
      liveCount: 0,
      reservedCount: 4,
      availableSlots: 0,
    })
  })

  it("commits, recovers, refocuses, and releases one exact slot only after close", () => {
    const budget = new WindowBudget()
    const reservations = ["main", "window-2", "window-3", "window-4"].map((stableId) => ({
      stableId,
      reservation: reserveWorkbench(budget, stableId),
    }))
    for (const { stableId, reservation } of reservations) {
      expect(
        budget.commit(reservationId(reservation), {
          stableId,
          kind: stableId === "main" ? "main" : "chat",
          hasProject: stableId !== "main",
          hasChat: stableId !== "main",
        }),
      ).toMatchObject({ status: "available" })
    }

    budget.markRecovering("window-3")
    expect(budget.inspect()).toMatchObject({ status: "at-limit", liveCount: 4, reservedCount: 0 })
    expect(
      budget.inspect().destinations.find((entry) => entry.stableId === "window-3"),
    ).toMatchObject({
      state: "recovering",
    })
    expect(budget.release("window-3")).toBe(true)
    expect(budget.release("window-3")).toBe(false)
    expect(budget.inspect()).toMatchObject({ status: "available", availableSlots: 1 })

    const replacement = reserveWorkbench(budget, "window-5")
    expect(replacement.status).toBe("available")
    expect(budget.inspect()).toMatchObject({ status: "at-limit", reservedCount: 1 })
  })

  it("expires abandoned reservations deterministically and rejects late commit", () => {
    const clock = fakeClock()
    const budget = new WindowBudget({ now: clock.now, reservationTtlMs: 100 })
    const reservation = reserveWorkbench(budget, "window-2")
    const id = reservationId(reservation)
    clock.advance(101)

    expect(
      budget.commit(id, {
        stableId: "window-2",
        kind: "chat",
        hasProject: true,
        hasChat: true,
      }),
    ).toMatchObject({ status: "reservation-expired", availableSlots: 4 })
    expect(reserveWorkbench(budget, "window-2")).toMatchObject({ status: "available" })
  })

  it("bounds expired reservation tombstones and cleans a consumed late commit", () => {
    const clock = fakeClock()
    const budget = new WindowBudget({ now: clock.now, reservationTtlMs: 1 })

    for (let index = 0; index < 512; index += 1) {
      reserveWorkbench(budget, `expired-${index}`)
      clock.advance(2)
      budget.inspect()
    }
    expect(budget.inspect().expiredReservationCount).toBeLessThanOrEqual(128)

    const late = reserveWorkbench(budget, "late")
    const lateId = reservationId(late)
    clock.advance(2)
    const expiredBeforeCommit = budget.inspect().expiredReservationCount
    expect(expiredBeforeCommit).toBeGreaterThan(0)
    budget.commit(lateId, {
      stableId: "late",
      kind: "chat",
      hasProject: false,
      hasChat: true,
    })
    expect(budget.inspect().expiredReservationCount).toBe(expiredBeforeCommit - 1)
  })

  it("binds each reservation to its requested stable ID and rejects duplicate reservations", () => {
    const budget = new WindowBudget()
    const first = reserveWorkbench(budget, "workspace:alpha")

    expect(reserveWorkbench(budget, "workspace:alpha")).toMatchObject({
      status: "stable-id-conflict",
      reservationId: null,
    })
    expect(
      budget.commit(reservationId(first), {
        stableId: "workspace:beta",
        kind: "workspace",
        hasProject: true,
        hasChat: false,
      }),
    ).toMatchObject({ status: "stable-id-mismatch" })
    expect(budget.inspect()).toMatchObject({ liveCount: 0, reservedCount: 0 })
  })

  it("rejects a duplicate committed stable ID without undercounting the live windows", () => {
    const budget = new WindowBudget()
    const first = reserveWorkbench(budget, "window-2")
    expect(
      budget.commit(reservationId(first), {
        stableId: "window-2",
        kind: "chat",
        hasProject: true,
        hasChat: true,
      }),
    ).toMatchObject({ status: "available", liveCount: 1 })

    const second = reserveWorkbench(budget)
    expect(
      budget.commit(reservationId(second), {
        stableId: "window-2",
        kind: "chat",
        hasProject: true,
        hasChat: true,
      }),
    ).toMatchObject({ status: "stable-id-conflict", liveCount: 1 })
    expect(budget.inspect()).toMatchObject({ liveCount: 1, reservedCount: 0 })
  })

  it.each(["register", "attach"] as const)(
    "unwinds a partial BrowserWindow after a %s fault exactly once",
    (faultStage) => {
      const budget = new WindowBudget()
      const reservation = reserveWorkbench(budget, "window-2")
      const id = reservationId(reservation)
      const calls: string[] = []
      if (faultStage === "attach") {
        budget.commit(id, {
          stableId: "window-2",
          kind: "chat",
          hasProject: false,
          hasChat: true,
        })
      }

      cleanupFailedWorkbenchWindowCreation({
        budget,
        reservationId: id,
        stableId: faultStage === "attach" ? "window-2" : null,
        window: { id: 42 },
        unregister: () => calls.push("unregister"),
        destroy: () => calls.push("destroy"),
      })
      cleanupFailedWorkbenchWindowCreation({
        budget,
        reservationId: id,
        stableId: faultStage === "attach" ? "window-2" : null,
        window: null,
        unregister: () => calls.push("unregister"),
        destroy: () => calls.push("destroy"),
      })

      expect(calls).toEqual(["unregister", "destroy"])
      expect(budget.inspect()).toMatchObject({
        status: "available",
        liveCount: 0,
        reservedCount: 0,
      })
    },
  )

  it("keeps dialog, picker, capture, and hidden utility reservations exempt", () => {
    const budget = new WindowBudget()
    for (const classification of [
      "dialog",
      "native-picker",
      "capture-overlay",
      "hidden-utility",
    ] as const) {
      expect(budget.reserve({ classification })).toMatchObject({
        status: "available",
        counted: false,
        reservationId: null,
      })
    }
    expect(budget.inspect()).toMatchObject({
      status: "available",
      liveCount: 0,
      reservedCount: 0,
      availableSlots: 4,
    })
  })

  it("returns redacted actionable destinations without source content", () => {
    let timestamp = 0
    const budget = new WindowBudget({ now: () => ++timestamp })
    for (const [index, stableId] of ["main", "window-2", "window-3", "window-4"].entries()) {
      const reservation = reserveWorkbench(budget, stableId)
      budget.commit(reservationId(reservation), {
        stableId,
        kind: index === 0 ? "main" : "workspace",
        hasProject: index > 0,
        hasChat: index > 0,
      })
    }

    const rejected = reserveWorkbench(budget, "window-5")
    expect(rejected.status).toBe("at-limit")
    expect(rejected.destinations).toHaveLength(4)
    expect(rejected.destinations[0]).toMatchObject({
      stableId: "main",
      label: "Main window",
      actions: ["focus", "cancel"],
    })
    expect(JSON.stringify(rejected.destinations)).not.toMatch(
      /transcript|credential|reasoning|secret/i,
    )
    budget.markRecovering("window-3")
    expect(
      budget.inspect().destinations.find((destination) => destination.stableId === "window-3"),
    ).toMatchObject({ actions: ["cancel"] })
    expect(
      usableWorkbenchWindowDestinations(budget.inspect().destinations).map(
        (entry) => entry.stableId,
      ),
    ).toEqual(["main", "window-4", "window-2"])
  })

  it("restores main plus the three most recently focused and keeps overflow dormant", () => {
    const budget = new WindowBudget()
    const restored = budget.selectRestorableWindows([
      { stableId: "window-old", lastFocusedAt: 1, valid: true },
      { stableId: "main", lastFocusedAt: 2, valid: true },
      { stableId: "window-3", lastFocusedAt: 30, valid: true },
      { stableId: "window-invalid", lastFocusedAt: 40, valid: false },
      { stableId: "window-4", lastFocusedAt: 20, valid: true },
      { stableId: "window-5", lastFocusedAt: 10, valid: true },
    ])

    expect(restored.active.map((entry) => entry.stableId)).toEqual([
      "main",
      "window-3",
      "window-4",
      "window-5",
    ])
    expect(restored.dormant.map((entry) => entry.stableId)).toEqual(["window-old"])
  })

  it("persists a bounded restore plan and exposes the next dormant window after a slot opens", () => {
    let serialized: string | null = JSON.stringify({
      version: 1,
      windows: [
        {
          stableId: "window-old",
          lastFocusedAt: 1,
          launch: { chatId: "chat-old" },
          bounds: { x: 10, y: 20, width: 900, height: 700 },
        },
        { stableId: "main", lastFocusedAt: 2, launch: {} },
        { stableId: "window-3", lastFocusedAt: 30, launch: { chatId: "chat-3" } },
        { stableId: "window-4", lastFocusedAt: 20, launch: { workspaceId: "workspace-4" } },
        { stableId: "window-5", lastFocusedAt: 10, launch: { chatId: "chat-5" } },
      ],
    })
    const writes: string[] = []
    const storage: WorkbenchWindowSessionStorage = {
      read: () => serialized,
      write: (next) => {
        serialized = next
        writes.push(next)
      },
    }
    const store = new WorkbenchWindowSessionStore(storage, { now: () => 50 })

    expect(store.selectForStartup()).toMatchObject({
      active: [
        { stableId: "main" },
        { stableId: "window-3" },
        { stableId: "window-4" },
        { stableId: "window-5" },
      ],
      dormant: [{ stableId: "window-old" }],
    })
    expect(store.nextDormant(["main", "window-3", "window-4", "window-5"])).toBeNull()
    expect(store.nextDormant(["main", "window-3", "window-4"])).toMatchObject({
      stableId: "window-5",
      launch: { chatId: "chat-5" },
    })

    store.touch("window-old", { x: 30, y: 40, width: 1000, height: 800 })
    expect(store.nextDormant(["main", "window-3", "window-4"])).toMatchObject({
      stableId: "window-old",
      lastFocusedAt: 50,
      bounds: { x: 30, y: 40, width: 1000, height: 800 },
    })
    expect(writes).toHaveLength(1)
  })

  it("synthesizes main and restores only three auxiliaries from a legacy auxiliary-only session", () => {
    const store = new WorkbenchWindowSessionStore({
      read: () =>
        JSON.stringify({
          version: 1,
          windows: [
            { stableId: "window-2", lastFocusedAt: 10, launch: { chatId: "chat-2" } },
            { stableId: "window-3", lastFocusedAt: 40, launch: { chatId: "chat-3" } },
            { stableId: "window-4", lastFocusedAt: 30, launch: { chatId: "chat-4" } },
            { stableId: "window-5", lastFocusedAt: 20, launch: { chatId: "chat-5" } },
          ],
        }),
      write: () => undefined,
    })

    const plan = store.selectForStartup()
    expect(plan.active.map((window) => window.stableId)).toEqual([
      "main",
      "window-3",
      "window-4",
      "window-5",
    ])
    expect(plan.dormant.map((window) => window.stableId)).toEqual(["window-2"])
  })

  it("preserves corrupt persisted window state instead of replacing it", () => {
    const writes: string[] = []
    const store = new WorkbenchWindowSessionStore({
      read: () => "{not-json",
      write: (next) => writes.push(next),
    })

    expect(store.inspect()).toMatchObject({ status: "corrupt", windows: [] })
    expect(() =>
      store.upsert({
        stableId: "main",
        lastFocusedAt: 1,
        launch: {},
      }),
    ).toThrow(WorkbenchWindowSessionCorruptError)
    expect(writes).toEqual([])
  })

  it("writes production session snapshots atomically without leaving temporary files", () => {
    const directory = mkdtempSync(join(tmpdir(), "flapstack-window-session-"))
    const filePath = join(directory, "workbench-windows.json")
    const storage = createFileWorkbenchWindowSessionStorage(filePath)

    expect(storage.read()).toBeNull()
    storage.write('{"version":1,"windows":[]}\n')
    storage.write('{"version":1,"windows":[{"stableId":"main"}]}\n')

    expect(existsSync(filePath)).toBe(true)
    expect(storage.read()).toBe('{"version":1,"windows":[{"stableId":"main"}]}\n')
    expect(storage.readBackup?.()).toBe('{"version":1,"windows":[]}\n')
    expect(readdirSync(directory)).toEqual([
      "workbench-windows.json",
      "workbench-windows.json.backup",
    ])
  })

  it("routes creation through safe typed entry points instead of throwing constructors", () => {
    const mainSource = readFileSync(join(process.cwd(), "src/main/windows/main.ts"), "utf8")
    const indexSource = readFileSync(join(process.cwd(), "src/main/index.ts"), "utf8")
    expect(mainSource).toContain("tryCreateWindow(")
    expect(mainSource).toContain("createWorkbenchWindowCreationFailure")
    expect(mainSource).toContain('ipcMain.handle("window:focus-stable"')
    expect(
      indexSource.match(/tryCreateWindowWithRendererChoice\(\)/g)?.length,
    ).toBeGreaterThanOrEqual(2)
    expect(indexSource).not.toMatch(/click:[\\s\\S]{0,160}createWindow\(\)/)
  })

  it("offers renderer Focus and Cancel choices for every at-limit creation surface", () => {
    const choiceSource = readFileSync(
      join(process.cwd(), "src/renderer/lib/workbench-window-limit.ts"),
      "utf8",
    )
    expect(choiceSource).toContain("`Focus ${destination.label}`")
    expect(choiceSource).toContain('"Cancel"')
    expect(choiceSource).toContain("focusStableWindow")
    expect(choiceSource).toContain("usableWorkbenchWindowDestinations")
    expect(choiceSource).not.toContain("destinations?.[0]")
    expect(choiceSource).toContain("showWorkbenchWindowCreationFeedback")
    expect(readFileSync(join(process.cwd(), "src/preload/index.ts"), "utf8")).toContain(
      'ipcRenderer.on("window:creation-blocked"',
    )
    expect(readFileSync(join(process.cwd(), "src/renderer/App.tsx"), "utf8")).toContain(
      "onWorkbenchWindowCreationBlocked",
    )
  })

  it("keeps capacity, expiry, and construction feedback truthfully distinct", () => {
    expect(describeWorkbenchWindowCreationFailure("window-limit")).toMatchObject({
      title: "Four-window limit reached",
      offersDestinations: true,
    })
    expect(describeWorkbenchWindowCreationFailure("reservation-expired")).toMatchObject({
      title: "Window creation timed out",
      offersDestinations: false,
    })
    expect(describeWorkbenchWindowCreationFailure("creation-failed")).toMatchObject({
      title: "Window could not be created",
      offersDestinations: false,
    })
    const destinations = [
      {
        stableId: "main",
        label: "Main window",
        kind: "main" as const,
        state: "available" as const,
        hasProject: false,
        hasChat: false,
        actions: ["focus", "cancel"] as const,
      },
    ]
    expect(createWorkbenchWindowCreationFailure("window-limit", destinations)).toEqual({
      reason: "window-limit",
      destinations,
    })
    expect(createWorkbenchWindowCreationFailure("reservation-expired", destinations)).toEqual({
      reason: "reservation-expired",
    })
    expect(createWorkbenchWindowCreationFailure("creation-failed", destinations)).toEqual({
      reason: "creation-failed",
    })
    expect(
      asWorkbenchWindowCreationFailure({
        reason: "creation-failed",
        destinations,
      }),
    ).toEqual({ reason: "creation-failed" })
  })

  it("wires persisted startup restoration and deferred dormant recovery into production", () => {
    const mainSource = readFileSync(join(process.cwd(), "src/main/windows/main.ts"), "utf8")
    const indexSource = readFileSync(join(process.cwd(), "src/main/index.ts"), "utf8")

    expect(mainSource).toContain("restoreWorkbenchWindows")
    expect(mainSource).toContain("restoreNextDormantWorkbenchWindow")
    expect(mainSource).toContain("createFileWorkbenchWindowSessionStorage")
    expect(mainSource).toContain('stableWindowId !== "main"')
    expect(indexSource).toContain("restoreWorkbenchWindows()")
    expect(indexSource).toContain('app.on("before-quit"')
  })

  it("propagates typed menu failures and wires a silent native second-instance fallback", () => {
    const mainSource = readFileSync(join(process.cwd(), "src/main/windows/main.ts"), "utf8")
    const preloadSource = readFileSync(join(process.cwd(), "src/preload/index.ts"), "utf8")
    const appSource = readFileSync(join(process.cwd(), "src/renderer/App.tsx"), "utf8")
    const indexSource = readFileSync(join(process.cwd(), "src/main/index.ts"), "utf8")

    expect(mainSource).toContain("workbenchCreationFailure(result)")
    expect(mainSource).toContain("notifyNativeWorkbenchWindowCreationBlocked")
    expect(mainSource).toContain("silent: true")
    expect(preloadSource).toContain("failure: WorkbenchWindowCreationBlocked")
    expect(appSource).toContain("showWorkbenchWindowCreationFeedback")
    expect(indexSource).toContain("notifyBlocked:")
  })

  it("routes every renderer creation caller through exact typed failure feedback", () => {
    for (const relativePath of [
      "src/renderer/features/agents/ui/sub-chat-context-menu.tsx",
      "src/renderer/features/sidebar/agents-sidebar.tsx",
      "src/renderer/features/saved-workspaces/saved-workspaces-view.tsx",
      "src/renderer/features/saved-workspaces/workspace-window-ownership.tsx",
    ]) {
      const source = readFileSync(join(process.cwd(), relativePath), "utf8")
      expect(source, relativePath).toContain("asWorkbenchWindowCreationFailure")
      expect(source, relativePath).toContain("showWorkbenchWindowCreationFeedback")
      expect(source, relativePath).not.toContain("showWorkbenchWindowLimitChoice")
    }
  })
})
