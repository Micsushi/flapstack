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
    window.prepareReconnect = (callback) => {
      lastMessageAt = -20000;
      pendingSend = { commandId: "kept", message: "Keep my draft" };
      connect = callback;
    };
    window.pendingCommand = () => pendingSend?.commandId;
    window.activateAccess = activateAccess;
    window.connectWithAccess = async (grants) => {
      socket = null;
      readPrivateKey = async () => ({});
      sessionProof = async () => ({ nonce: "test-proof" });
      challengeMessage = async () => "challenge";
      signText = async () => "signature";
      post = async (path) => path.endsWith("/grants") ? { grants } : path.endsWith("/authenticate") ? sessionCredential : {};
      await connect();
    };
  `,
  )
  const api = window as unknown as {
    receive: (value: unknown) => void
    connected: (value: boolean) => void
    prepareReconnect: (callback: () => void) => void
    pendingCommand: () => string | undefined
    activateAccess: (grantId: string) => void
    connectWithAccess: (grants: { grantId: string; label: string }[]) => Promise<void>
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

it("preserves a chat draft across updates and clears it only after its matching send succeeds", () => {
  const app = companion()
  app.api.connected(true)
  app.snapshot([{ kind: "project", id: "project", name: "Example", version: 1 }])
  app.button("New chat")!.click()
  const input = app.window.document.getElementById("message") as HTMLTextAreaElement
  input.value = "Explain this project"
  input.dispatchEvent(new app.window.Event("input"))
  app.snapshot([{ kind: "project", id: "project", name: "Example", version: 2 }])
  expect(input.value).toBe("Explain this project")
  app.window.document
    .getElementById("compose")!
    .dispatchEvent(new app.window.Event("submit", { cancelable: true }))
  const command = JSON.parse(app.send.mock.calls[0]![0])
  expect(command.action).toEqual({
    type: "chat.create",
    harness: "codex",
    message: "Explain this project",
  })
  expect(input.value).toBe("Explain this project")
  app.api.receive({
    kind: "event",
    payload: { type: "action.result", commandId: command.commandId, status: "denied" },
  })
  expect(input.value).toBe("Explain this project")
  expect(app.window.document.getElementById("send-status")!.textContent).toContain("Not sent")
})

it("loads paginated snapshots without losing earlier projects", () => {
  const app = companion()
  app.api.connected(true)
  app.api.receive({
    kind: "snapshot",
    freshUntil: 60000,
    nextCursor: "next",
    items: [{ kind: "project", id: "project", name: "Example", version: 1 }],
  })
  expect(JSON.parse(app.send.mock.calls[0]![0]).kind).toBe("snapshot.page")
  app.api.receive({
    kind: "snapshot",
    freshUntil: 60000,
    items: [{ kind: "chat", id: "chat", name: "Existing", version: 1 }],
  })
  app.button("New chat")!.click()
  expect(app.window.document.getElementById("project")!.textContent).toBe("Example")
})

it("keeps an unsent new-chat draft when returning through the chat list", () => {
  const app = companion()
  app.api.connected(true)
  app.snapshot([{ kind: "project", id: "project", name: "Example", version: 1 }])
  app.button("New chat")!.click()
  const input = app.window.document.getElementById("message") as HTMLTextAreaElement
  input.value = "Keep this draft"
  input.dispatchEvent(new app.window.Event("input"))
  app.button("Chats")!.click()
  app.button("New chat")!.click()
  expect(input.value).toBe("Keep this draft")
})

it("recovers a received send after reconnect without sending the message again", () => {
  const app = companion()
  app.api.connected(true)
  app.snapshot([{ kind: "project", id: "project", name: "Example", version: 1 }])
  app.button("New chat")!.click()
  const input = app.window.document.getElementById("message") as HTMLTextAreaElement
  input.value = "Start the task"
  input.dispatchEvent(new app.window.Event("input"))
  app.window.document
    .getElementById("compose")!
    .dispatchEvent(new app.window.Event("submit", { cancelable: true }))
  const command = JSON.parse(app.send.mock.calls[0]![0])
  app.api.connected(false)
  app.api.connected(true)
  app.snapshot([
    { kind: "chat", id: "mobile-" + command.commandId, name: "Start the task", version: 1 },
  ])
  app.api.receive({
    kind: "conversation",
    conversation: {
      chatId: "mobile-" + command.commandId,
      subChatId: "sub",
      conversations: [{ id: "sub" }],
      messages: [],
      acceptedCommands: [command.commandId],
      before: null,
      pageBefore: null,
      status: "pending",
    },
  })
  expect(
    app.send.mock.calls
      .map((call) => JSON.parse(call[0]))
      .filter((value) => value.kind === "command"),
  ).toHaveLength(1)
  expect(app.window.document.getElementById("send-status")!.textContent).toBe("Sent")
  expect(input.value).toBe("")
})

it("refreshes a half-open phone connection after returning without replaying a send", () => {
  const app = companion()
  app.api.connected(true)
  const reconnect = vi.fn()
  app.api.prepareReconnect(reconnect)
  Object.defineProperty(app.window.document, "visibilityState", {
    configurable: true,
    value: "visible",
  })
  app.window.document.dispatchEvent(new app.window.Event("visibilitychange"))
  expect(reconnect).toHaveBeenCalledOnce()
  expect(app.send).not.toHaveBeenCalled()
  expect(app.api.pendingCommand()).toBe("kept")
})

it("discovers named access and subscribes without typing a grant ID", async () => {
  const app = companion()
  const send = vi.fn()
  let socket: InstanceType<typeof app.window.EventTarget> | undefined
  class TestSocket extends app.window.EventTarget {
    static OPEN = 1
    readyState = 1
    send = send
    close() {}
    constructor() {
      super()
      socket = this
    }
  }
  Object.assign(app.window, { WebSocket: TestSocket })
  await app.api.connectWithAccess([{ grantId: "allowed", label: "Flapstack" }])
  socket!.dispatchEvent(new app.window.Event("open"))
  expect(JSON.parse(send.mock.calls[0][0])).toMatchObject({ authorityGrantId: "allowed" })
  expect(app.window.localStorage.getItem("flapstack-mobile-grant")).toBe("allowed")
  expect(app.window.document.getElementById("access-choice")?.hidden).toBe(true)
  expect(app.window.document.getElementById("grant-id")?.textContent).toBe("Flapstack")
})

it("waits for desktop access without retaining a revoked grant", async () => {
  const app = companion()
  app.window.localStorage.setItem("flapstack-mobile-grant", "revoked")
  await app.api.connectWithAccess([])
  expect(app.window.localStorage.getItem("flapstack-mobile-grant")).toBeNull()
  expect(app.window.document.getElementById("pairing-result")?.textContent).toContain(
    "Waiting for access",
  )
  expect(app.send).not.toHaveBeenCalled()
})

it("switches access without reading the previous chat or losing its pending delivery", () => {
  const app = companion()
  const chatA = { kind: "chat", id: "chat-a", name: "Chat A", version: 1 }
  const chatB = { kind: "chat", id: "chat-b", name: "Chat B", version: 1 }
  app.api.activateAccess("access-a")
  app.api.connected(true)
  app.snapshot([chatA])
  app.button("Chat A")!.click()
  app.api.receive({
    kind: "conversation",
    conversation: {
      chatId: "chat-a",
      subChatId: "sub-a",
      conversations: [{ id: "sub-a" }],
      messages: [{ id: "answer-a", role: "assistant", text: "Private A response" }],
      status: "idle",
      pageBefore: null,
      before: null,
    },
  })
  const input = app.window.document.getElementById("message") as HTMLTextAreaElement
  input.value = "A follow-up"
  input.dispatchEvent(new app.window.Event("input"))
  app.window.document
    .getElementById("compose")!
    .dispatchEvent(new app.window.Event("submit", { cancelable: true }))
  const commandA = app.api.pendingCommand()
  expect(commandA).toBeTruthy()
  app.api.activateAccess("access-b")
  app.send.mockClear()
  app.snapshot([chatB])
  expect(app.window.document.getElementById("chat-title")?.textContent).toBe("Chats")
  expect(app.window.document.getElementById("messages")?.textContent).toBe("")
  expect(app.api.pendingCommand()).toBeUndefined()
  app.button("Chat B")!.click()
  expect(app.send.mock.calls.map(([value]) => JSON.parse(value))).toEqual([
    { kind: "conversation.read", chatId: "chat-b" },
  ])
  expect(app.window.sessionStorage.getItem("flapstack-mobile-drafts")).toContain("A follow-up")
  app.api.activateAccess("access-a")
  expect(app.api.pendingCommand()).toBe(commandA)
  expect(app.send.mock.calls.every(([value]) => JSON.parse(value).kind !== "command")).toBe(true)
})
