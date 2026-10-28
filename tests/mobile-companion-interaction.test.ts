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
    window.stubSide = callback => { sideRequest = callback; };
    window.refreshSide = refreshSide;
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
    stubSide: (callback: (request: Record<string, unknown>) => Promise<unknown>) => void
    refreshSide: () => Promise<void>
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

it("keeps the viewed chat and both drafts while reconciling a pending send after reconnect", () => {
  const app = companion()
  const chatA = { kind: "chat", id: "chat-a", name: "Chat A", version: 1 }
  const chatB = { kind: "chat", id: "chat-b", name: "Chat B", version: 1 }
  app.api.connected(true)
  app.snapshot([chatA, chatB])
  app.button("Chat A")!.click()
  app.api.receive({
    kind: "conversation",
    conversation: {
      chatId: "chat-a",
      subChatId: "sub-a",
      conversations: [{ id: "sub-a" }],
      messages: [],
      status: "idle",
      pageBefore: null,
      before: null,
    },
  })
  const input = app.window.document.getElementById("message") as HTMLTextAreaElement
  input.value = "A pending message"
  input.dispatchEvent(new app.window.Event("input"))
  app.window.document
    .getElementById("compose")!
    .dispatchEvent(new app.window.Event("submit", { cancelable: true }))
  const pending = app.api.pendingCommand()
  expect(pending).toBeTruthy()

  app.button("Chats")!.click()
  app.button("Chat B")!.click()
  app.api.receive({
    kind: "conversation",
    conversation: {
      chatId: "chat-b",
      subChatId: "sub-b",
      conversations: [{ id: "sub-b" }],
      messages: [],
      status: "idle",
      pageBefore: null,
      before: null,
    },
  })
  input.value = "B local draft"
  input.dispatchEvent(new app.window.Event("input"))

  const sentBeforeReconnect = app.send.mock.calls.length
  app.api.connected(false)
  app.api.connected(true)
  app.snapshot([chatA, chatB])

  expect(input.value).toBe("B local draft")
  expect(app.window.document.getElementById("chat-title")!.textContent).toBe("Chat B")
  expect(app.window.sessionStorage.getItem("flapstack-mobile-drafts")).toContain(
    "A pending message",
  )
  expect(app.api.pendingCommand()).toEqual(pending)
  const sent = app.send.mock.calls.map((call) => JSON.parse(call[0]))
  expect(sent.filter((value) => value.kind === "command")).toHaveLength(1)
  expect(
    sent
      .slice(sentBeforeReconnect)
      .some((value) => value.kind === "conversation.read" && value.chatId === "chat-a"),
  ).toBe(true)
  expect(app.window.sessionStorage.getItem("flapstack-mobile-drafts")).toContain("B local draft")
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

it("keeps new-chat drafts scoped to their access and project", () => {
  const app = companion()
  const projectA = { kind: "project", id: "project-a", name: "A", version: 1 }
  const projectB = { kind: "project", id: "project-b", name: "B", version: 1 }
  app.api.activateAccess("access-a")
  app.api.connected(true)
  app.snapshot([projectA, projectB])
  app.button("New chat")!.click()
  const input = app.window.document.getElementById("message") as HTMLTextAreaElement
  const project = app.window.document.getElementById("project") as HTMLSelectElement
  input.value = "Only for project A"
  input.dispatchEvent(new app.window.Event("input"))
  project.value = "project-b"
  project.dispatchEvent(new app.window.Event("change"))
  expect(input.value).toBe("")
  project.value = "project-a"
  project.dispatchEvent(new app.window.Event("change"))
  expect(input.value).toBe("Only for project A")
  app.api.activateAccess("access-b")
  app.snapshot([projectB])
  expect(app.window.document.getElementById("compose")!.hidden).toBe(true)
  app.button("New chat")!.click()
  expect(input.value).toBe("")
  app.api.activateAccess("access-a")
  app.snapshot([projectA, projectB])
  app.button("New chat")!.click()
  project.value = "project-a"
  project.dispatchEvent(new app.window.Event("change"))
  expect(input.value).toBe("Only for project A")
})

function openConversation(app: ReturnType<typeof companion>) {
  app.api.activateAccess("access")
  app.api.connected(true)
  app.snapshot([{ kind: "chat", id: "chat", name: "Chat", version: 1 }])
  app.button("Chat")!.click()
  app.api.receive({
    kind: "conversation",
    conversation: {
      chatId: "chat",
      subChatId: "sub",
      conversations: [{ id: "sub" }],
      messages: [
        { id: "user", role: "user", text: "My earlier request" },
        { id: "assistant", role: "assistant", text: "I am working" },
      ],
      status: "running",
      pageBefore: null,
      before: null,
    },
  })
  app.send.mockClear()
}
it("replies to either role and preserves or removes the reference with the draft", () => {
  const app = companion()
  openConversation(app)
  const buttons = [...app.window.document.querySelectorAll<HTMLButtonElement>(".reply-action")]
  buttons[0].click()
  expect(app.window.document.getElementById("reply-text")!.textContent).toContain(
    "You: My earlier request",
  )
  app.window.document.getElementById("remove-reply")!.click()
  expect(app.window.document.getElementById("reply-preview")!.hidden).toBe(true)
  buttons[1].click()
  app.button("Chats")!.click()
  app.button("Chat")!.click()
  app.api.receive({
    kind: "conversation",
    conversation: {
      chatId: "chat",
      subChatId: "sub",
      conversations: [{ id: "sub" }],
      messages: [],
      status: "running",
      pageBefore: null,
      before: null,
    },
  })
  expect(app.window.document.getElementById("reply-text")!.textContent).toContain(
    "Flapstack: I am working",
  )
  const input = app.window.document.getElementById("message") as HTMLTextAreaElement
  input.value = "Explain that"
  input.dispatchEvent(new app.window.Event("input"))
  app.window.document
    .getElementById("compose")!
    .dispatchEvent(new app.window.Event("submit", { cancelable: true }))
  const sent = app.send.mock.calls
    .map(([value]) => JSON.parse(value))
    .find((value) => value.kind === "command")
  expect(sent.action.reply).toEqual({
    messageId: "assistant",
    role: "assistant",
    text: "I am working",
  })
  expect(sent.action.message).toContain("Explain that")
  app.api.receive({
    kind: "event",
    payload: { type: "action.result", commandId: sent.commandId, status: "completed" },
  })
  expect(app.window.document.getElementById("reply-preview")!.hidden).toBe(true)
})
it("asks, stops, retries and promotes side questions without sending or steering the main chat", async () => {
  const app = companion()
  openConversation(app)
  let entry = {
    id: "side",
    threadId: "side",
    question: "Progress?",
    answer: "",
    status: "running",
    createdAt: 1,
    error: null,
  }
  const call = vi.fn(async (request: Record<string, unknown>) => {
    if (request.operation === "list") return { entries: [entry], before: null }
    if (request.operation === "cancel") entry = { ...entry, status: "cancelled" }
    if (request.operation === "retry")
      entry = { ...entry, status: "completed", answer: "Still working" }
    if (request.operation === "promote") return { chatId: "promoted", subChatId: "promoted-sub" }
    return { entry }
  })
  app.api.stubSide(call)
  const panel = app.window.document.getElementById("side-questions") as HTMLDetailsElement
  panel.open = true
  await vi.waitFor(() => expect(app.button("Stop")?.disabled).toBe(false))
  const input = app.window.document.getElementById("side-message") as HTMLTextAreaElement
  input.value = "Progress?"
  app.window.document
    .getElementById("side-form")!
    .dispatchEvent(new app.window.Event("submit", { cancelable: true }))
  await vi.waitFor(() =>
    expect(call).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "ask", question: "Progress?" }),
    ),
  )
  await vi.waitFor(() => expect(app.button("Stop")!.disabled).toBe(false))
  app.button("Stop")!.click()
  expect(call.mock.calls).toEqual(expect.arrayContaining([[{ operation: "cancel", id: "side" }]]))
  await vi.waitFor(() => expect(app.button("Retry")).toBeTruthy())
  app.button("Retry")!.click()
  await vi.waitFor(() => expect(app.button("Open as chat")).toBeTruthy())
  app.button("Open as chat")!.click()
  await vi.waitFor(() => expect(call).toHaveBeenCalledWith({ operation: "promote", id: "side" }))
  expect(
    app.send.mock.calls
      .map(([value]) => JSON.parse(value))
      .some((value) => value.kind === "command"),
  ).toBe(false)
})

it("starts a fresh side conversation after promotion and refreshes an unaccepted retry", async () => {
  const app = companion()
  openConversation(app)
  let promoted = false,
    fail = true
  const old = {
    id: "old",
    threadId: "old",
    question: "Old",
    answer: "Done",
    status: "completed",
    createdAt: 1,
    promotedChatId: null as string | null,
  }
  const call = vi.fn(async (request: Record<string, unknown>) => {
    if (request.operation === "list")
      return {
        entries: [{ ...old, promotedChatId: promoted ? "promoted" : null }],
        accepted: false,
        before: null,
      }
    if (fail) {
      fail = false
      throw new Error("not accepted")
    }
    return {
      entry: {
        ...old,
        id: request.requestId,
        threadId: request.threadId || request.requestId,
        question: request.question,
        status: "running",
      },
    }
  })
  app.api.stubSide(call)
  const panel = app.window.document.getElementById("side-questions") as HTMLDetailsElement
  panel.open = true
  await vi.waitFor(() => expect(app.button("Open as chat")?.disabled).toBe(false))
  const input = app.window.document.getElementById("side-message") as HTMLTextAreaElement
  input.value = "Another question"
  const submit = () =>
    app.window.document
      .getElementById("side-form")!
      .dispatchEvent(new app.window.Event("submit", { cancelable: true }))
  submit()
  await vi.waitFor(() =>
    expect(app.window.document.getElementById("side-status")!.textContent).toContain(
      "Could not complete",
    ),
  )
  const first = call.mock.calls.find(([r]) => r.operation === "ask")![0]
  expect(first.threadId).toBe("old")
  promoted = true
  submit()
  await vi.waitFor(() =>
    expect(call.mock.calls.filter(([r]) => r.operation === "ask")).toHaveLength(2),
  )
  const second = call.mock.calls.filter(([r]) => r.operation === "ask")[1][0]
  expect(second.requestId).toBe(first.requestId)
  expect(second.threadId).toBeUndefined()
})

it.each([false, true])(
  "keeps a newer side draft after a delayed delivery check (ask fails: %s)",
  async (fails) => {
    const app = companion()
    openConversation(app)
    let release: ((value: unknown) => void) | undefined
    app.api.stubSide(async (request) => {
      if (request.operation === "list" && request.requestId)
        return new Promise((resolve) => {
          release = resolve
        })
      if (request.operation === "list") return { entries: [], before: null }
      if (fails) throw new Error("Synthetic unknown delivery")
      return {
        entry: {
          id: request.requestId,
          question: request.question,
          status: "running",
          createdAt: 1,
        },
      }
    })
    const panel = app.window.document.getElementById("side-questions") as HTMLDetailsElement
    panel.open = true
    await vi.waitFor(() => expect(app.button("Ask")?.disabled).toBe(false))
    const input = app.window.document.getElementById("side-message") as HTMLTextAreaElement
    input.value = "Submitted question"
    input.dispatchEvent(new app.window.Event("input"))
    app.window.document
      .getElementById("side-form")!
      .dispatchEvent(new app.window.Event("submit", { cancelable: true }))
    await vi.waitFor(() => expect(release).toBeTypeOf("function"))
    input.value = "Newer unsent question"
    input.dispatchEvent(new app.window.Event("input"))
    release!({ entries: [], before: null, accepted: false })
    await vi.waitFor(() => expect(app.button("Ask")?.disabled).toBe(false))
    expect(
      JSON.parse(app.window.sessionStorage.getItem("flapstack-mobile-side-drafts")!)[
        "access:chat:sub"
      ],
    ).toEqual({ question: "Newer unsent question" })
    app.button("Chats")!.click()
    openConversation(app)
    expect(input.value).toBe("Newer unsent question")
  },
)

it("hides the main composer while the side panel is open and restores it on close", async () => {
  const app = companion()
  openConversation(app)
  app.api.stubSide(async () => ({ entries: [], before: null }))
  const panel = app.window.document.getElementById("side-questions") as HTMLDetailsElement
  const compose = app.window.document.getElementById("compose")!
  panel.open = true
  await vi.waitFor(() => expect(compose.hidden).toBe(true))
  const input = app.window.document.getElementById("message") as HTMLTextAreaElement
  input.value = "Do not send"
  compose.dispatchEvent(new app.window.Event("submit", { cancelable: true }))
  expect(
    app.send.mock.calls
      .map(([value]) => JSON.parse(value))
      .some((value) => value.kind === "command"),
  ).toBe(false)
  panel.open = false
  await vi.waitFor(() => expect(compose.hidden).toBe(false))
  expect(input.value).toBe("Do not send")
})
