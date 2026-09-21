import { JSDOM } from "jsdom"
import { afterEach, expect, it, vi } from "vitest"
import { getMobileCompanionAsset } from "../src/main/lib/mobile-bridge/pwa"

const windows: JSDOM[] = []
afterEach(() => windows.splice(0).forEach((dom) => dom.window.close()))

function companion() {
  const dom = new JSDOM(getMobileCompanionAsset("/")!.body, {
    url: "https://owned.invalid",
    runScripts: "outside-only",
  })
  windows.push(dom)
  const { window } = dom
  let now = 1000
  let tick = () => {}
  window.Date.now = () => now
  window.setInterval = ((callback: () => void) => {
    tick = callback
    return 1
  }) as typeof window.setInterval
  const send = vi.fn()
  const notify = vi.fn()
  Object.assign(window, {
    ownedSocket: { readyState: 1, send },
    confirm: () => true,
    Notification: class {
      static permission = "granted"
      constructor() {
        notify()
        throw new Error("synthetic notification delivery failure")
      }
    },
  })
  window.localStorage.setItem(
    "flapstack-mobile-session",
    JSON.stringify({
      session: {
        sessionId: "session",
        deviceId: "device",
        scopeVersion: 1,
      },
    }),
  )
  // Execute the shipped asset unchanged; only its transport boundary is synthetic.
  window.eval(
    getMobileCompanionAsset("/mobile-app.js")!.body +
      `
    socket = window.ownedSocket;
    window.receive = applyEnvelope;
    window.connected = setOnline;
  `,
  )
  const api = window as unknown as {
    receive: (value: unknown) => void
    connected: (value: boolean) => void
  }
  const snapshot = (items: unknown[]) => api.receive({ kind: "snapshot", freshUntil: 60000, items })
  const button = (label: string) =>
    [...window.document.querySelectorAll("button")].find((b) => b.textContent === label)
  return {
    window,
    api,
    snapshot,
    button,
    send,
    notify,
    advance: (time: number) => {
      now = time
      tick()
    },
  }
}

it("suppresses offline controls and replaces cached work on a fresh reconnect snapshot", () => {
  const app = companion()
  app.api.connected(true)
  app.snapshot([{ kind: "run", id: "old", name: "Old run", version: 1 }])
  expect(app.button("Pause")?.disabled).toBe(false)
  app.window.dispatchEvent(new app.window.Event("offline"))
  expect(app.button("Pause")?.disabled).toBe(true)
  app.button("Pause")!.click()
  expect(app.send).not.toHaveBeenCalled()
  app.api.connected(true)
  expect(app.button("Pause")?.disabled).toBe(true)
  app.snapshot([{ kind: "run", id: "new", name: "New run", version: 2 }])
  expect(app.window.document.getElementById("items")!.textContent).not.toContain("Old run")
  app.button("Pause")!.click()
  expect(JSON.parse(app.send.mock.calls[0]![0]).target.id).toBe("new")
})

it("attempts notification once per approval version and never from stale or offline state", () => {
  const app = companion()
  const item = {
    kind: "approval",
    id: "approval",
    action: "Owned action",
    version: 1,
    expiresAt: 90000,
  }
  app.snapshot([item])
  expect(app.notify).not.toHaveBeenCalled()
  app.api.connected(true)
  expect(app.notify).toHaveBeenCalledTimes(1)
  app.snapshot([item])
  app.advance(61000)
  app.advance(62000)
  expect(app.notify).toHaveBeenCalledTimes(1)
  app.api.receive({ kind: "snapshot", freshUntil: 80000, items: [{ ...item, version: 2 }] })
  expect(app.notify).toHaveBeenCalledTimes(2)
})

it("removes expired approval actions while the snapshot is still fresh and rejects a retained stale button", () => {
  const app = companion()
  app.api.connected(true)
  app.snapshot([
    { kind: "approval", id: "approval", action: "Owned action", version: 1, expiresAt: 2000 },
  ])
  const stale = app.button("Deny")!
  app.advance(2001)
  expect(app.button("Deny")).toBeUndefined()
  stale.click()
  expect(app.send).not.toHaveBeenCalled()
})

it("removes revoked approval cards and reports notification delivery failure", () => {
  const app = companion()
  app.api.connected(true)
  app.snapshot([
    { kind: "approval", id: "approval", action: "Owned action", version: 1, expiresAt: 2000 },
  ])
  const stale = app.button("Deny")!
  expect(app.window.document.getElementById("pairing-result")!.textContent).toMatch(
    /notification.*failed/i,
  )
  app.api.receive({
    kind: "event",
    payload: { type: "entity.remove", resource: { kind: "approval", id: "approval" } },
  })
  expect(app.button("Approve")).toBeUndefined()
  stale.click()
  expect(app.send).not.toHaveBeenCalled()
})
