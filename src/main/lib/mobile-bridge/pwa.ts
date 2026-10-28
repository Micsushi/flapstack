import { formatMessageReply, parseMessageReply } from "../../../shared/message-replies"
export type MobileCompanionAsset = {
  status: 200
  contentType: string
  body: string
}

export const mobileCompanionAssetPaths = [
  "/",
  "/mobile-app.js",
  "/manifest.webmanifest",
  "/service-worker.js",
] as const

const documentBody = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,interactive-widget=resizes-content">
    <meta name="theme-color" content="#171717">
    <link rel="manifest" href="/manifest.webmanifest">
    <title>Flapstack</title>
    <style>
      :root{font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#202020;background:#fff;color-scheme:light dark;--surface:#fff;--muted:#666;--line:#e5e5e5;--soft:#f4f4f4;--fg:#202020}
      *{box-sizing:border-box}body{margin:0}main{max-width:52rem;margin:auto;padding:0 1rem env(safe-area-inset-bottom);min-height:100dvh;display:flex;flex-direction:column}
      header{display:flex;align-items:center;justify-content:space-between;gap:.75rem;min-height:64px}h1{font-size:20px;margin:0}h2{font-size:18px;margin:0 0 16px}button,input,textarea,select{font:inherit;color:inherit;min-height:44px;border-radius:10px;border:1px solid var(--line);background:var(--surface);padding:10px 12px}button{cursor:pointer}button:hover{background:var(--soft)}button:disabled{opacity:.45;cursor:default}button:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible{outline:2px solid var(--fg);outline-offset:2px}label{display:block;margin:12px 0}input:not([type=checkbox]):not([type=radio]),textarea{width:100%}input[type=checkbox],input[type=radio]{min-height:24px;width:24px;vertical-align:middle}textarea{resize:vertical}select{max-width:100%}#fingerprint{overflow-wrap:anywhere}section{margin:16px 0}summary{cursor:pointer;min-height:44px;padding:10px 0}.muted{color:var(--muted)}.danger{color:#bb2222}.actions{display:flex;gap:8px;flex-wrap:wrap}.item{padding:16px 0;border-top:1px solid var(--line)}#connection{font-size:13px;font-weight:400;color:var(--muted)}#settings{border-bottom:1px solid var(--line);padding-bottom:12px}#settings>summary{display:none}#settings:not([open]){margin:0;padding:0;border:0}#connection{border:0;padding-right:0}#chat-toolbar{position:sticky;top:0;z-index:1;background:var(--surface);display:flex;align-items:center;gap:8px;border-bottom:1px solid var(--line);padding:8px 0}#chat-title{flex:1;font-size:16px;white-space:nowrap;text-overflow:ellipsis;overflow:hidden}#chat-list{display:grid;gap:4px}#chat-list button{text-align:left;border:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}#conversation{flex:1;min-height:30dvh}#chat-list:not([hidden]){flex:1;align-content:start}#pairing-result:empty,#send-status:empty{display:none}#messages{padding:24px 0;display:flex;flex-direction:column;gap:24px}.message{white-space:pre-wrap;overflow-wrap:anywhere;max-width:100%;margin:0}.message.user{align-self:flex-end;background:var(--soft);padding:12px 16px;border-radius:16px;max-width:88%}.message.assistant{line-height:1.65}.reply-preview{border-left:1px solid var(--line);padding:8px 12px;margin:8px 0;font-size:14px;color:var(--muted);white-space:pre-wrap;overflow-wrap:anywhere}.reply-action{display:block;font-size:13px;border:0;background:transparent;color:var(--muted);padding:4px 8px}.side-entry{padding:12px 0;border-bottom:1px solid var(--line);white-space:pre-wrap;overflow-wrap:anywhere}#side-questions{border-top:1px solid var(--line)}#side-form{display:flex;gap:6px;align-items:flex-end}#side-message{min-height:48px}#compose{position:sticky;bottom:0;padding:12px 0 max(12px,env(safe-area-inset-bottom));background:var(--surface)}#composer{display:flex;align-items:flex-end;border:1px solid var(--line);border-radius:18px;padding:6px;gap:6px}#message{border:0;resize:none;max-height:160px;min-height:48px;background:transparent}#send{background:var(--fg);color:var(--surface);border:0;flex-shrink:0}#new-options{display:flex;gap:8px;padding-bottom:12px}#new-options select{min-width:0;max-width:60%}#pairing-result{margin:8px 0;font-size:14px}#activity{font-size:14px;color:var(--muted)}[hidden]{display:none!important}
      @media(prefers-color-scheme:dark){:root{color:#eee;background:#171717;--surface:#171717;--muted:#aaa;--line:#363636;--soft:#292929;--fg:#eee}.danger{color:#ff8e8e}}
      @media(min-width:700px){main{padding-inline:32px}#conversation{min-height:50dvh}}
    </style>
  </head>
  <body>
    <main>
      <header><h1>Flapstack</h1><button id="connection" data-mode="offline" aria-label="Connection settings" aria-live="polite">Offline · read-only</button></header>
      <section id="app-update" hidden aria-label="Companion update"><p id="update-status" role="status"></p><button id="reload-update" type="button" aria-describedby="update-status">Reload to update</button></section>
      <details id="settings"><summary>Connection</summary>
      <section id="pairing">
        <h2>Pair this device</h2>
        <p id="fingerprint" class="muted">Open a fresh QR pairing link from desktop Flapstack.</p>
        <label><input id="fingerprint-confirmed" type="checkbox"> I confirmed this certificate fingerprint on the desktop.</label>
        <label>Device name <input id="device-name" maxlength="120" value="Mobile browser"></label>
        <button id="pair-device" disabled>Pair device</button>

      </section>
      <section>
        <label id="access-choice" hidden>Access <select id="grant-id"></select></label>
        <label>Desktop step-up token <input id="step-up-token" autocomplete="off" maxlength="512" aria-describedby="step-up-help"></label>
        <p id="step-up-help" class="muted">Privileged approve or cancel actions require a fresh one-time token created on the desktop.</p>
        <div class="actions">
          <button id="connect" disabled>Connect</button>
          <button id="notifications" type="button">Enable notifications</button>
        </div>
        <p class="muted">Notifications are best effort while this companion is connected. Delivery is never guaranteed.</p>

      </section>
      </details>
      <p id="pairing-result" role="status"></p>
      <div id="chat-toolbar"><button id="back" hidden>Chats</button><strong id="chat-title">Chats</strong><button id="new-chat">New chat</button></div>
      <nav id="chat-list" aria-label="Conversations"></nav>
      <section id="conversation" hidden><button id="older" hidden>Earlier messages</button><select id="conversation-select" aria-label="Conversation" hidden></select><div id="messages" role="log" aria-label="Messages"></div><p id="activity" role="status"></p><details id="side-questions"><summary>Side question</summary><button id="side-older" hidden>Earlier questions</button><div id="side-messages" role="log" aria-label="Side conversation"></div><form id="side-form"><textarea id="side-message" aria-label="Side question" placeholder="Ask a question…" maxlength="8000" rows="1"></textarea><button id="side-send" type="submit">Ask</button></form><p id="side-status" role="status"></p></details></section>
      <form id="compose" hidden><div id="new-options"><select id="project" aria-label="Project"></select><select id="harness" aria-label="Agent"><option value="codex">Codex</option><option value="claude-code">Claude</option></select></div><div id="reply-preview" class="reply-preview" hidden><span id="reply-text"></span><button id="remove-reply" type="button" aria-label="Remove reply">×</button></div><div id="composer"><textarea id="message" aria-label="Message" placeholder="Message Flapstack" maxlength="8000" rows="1"></textarea><button id="send" type="submit">Send</button></div><p id="send-status" role="status"></p></form>
      <details id="attention"><summary>Activity & approvals</summary><div id="items"></div></details>
    </main>
    <script type="module" src="/mobile-app.js"></script>
  </body>
</html>`

const applicationBody =
  `const formatMessageReply = ${formatMessageReply.toString()};\nconst parseMessageReply = ${parseMessageReply.toString()};\n` +
  String.raw`
const $ = (id) => document.getElementById(id)
const connection = $("connection")
const pairButton = $("pair-device")
const connectButton = $("connect")
const grantInput = $("grant-id")
const itemsRoot = $("items")
let offer = readOffer()
let pairingBusy = false
let waitingWorker = null
let updateNeedsReload = false
let updateApplying = false
let updateError = ""
let updateTimer = null
let sideRequests = 0
let navigationGeneration = 0
const controlCommands = readJson(sessionStorage.getItem("flapstack-mobile-controls")) || {}
const controlKey = target => JSON.stringify([activeGrantId,target.kind,target.id,target.version])
function storeControls() { sessionStorage.setItem("flapstack-mobile-controls", JSON.stringify(controlCommands)) }
let socket = null
let sessionCredential = readJson(localStorage.getItem("flapstack-mobile-session"))
let currentItems = new Map()
const notificationAttempts = new Map()
let online = false
let capabilities = null
let refreshPending = false
let receivedSnapshot = false
let snapshotPaging = false
let freshUntil = 0
let lastExpiryCheck = Date.now()

let selectedChat = null
let selectedConversation = null
let conversationBefore = null
let newChat = false
let newChatProject = ""
let promotedChat = null
let sideKey = ""
let sideEntries = []
let sideBefore = null
let sideBusy = false
let sideGeneration = 0
const replies = readJson(sessionStorage.getItem("flapstack-mobile-replies")) || {}
const sideDrafts = readJson(sessionStorage.getItem("flapstack-mobile-side-drafts")) || {}
let activeGrantId = localStorage.getItem("flapstack-mobile-grant") || ""
let pendingSend = readJson(sessionStorage.getItem("flapstack-mobile-pending"))
function storePending() {
  if (pendingSend) {
    pendingSend.grantId = pendingSend.grantId || activeGrantId
    sessionStorage.setItem("flapstack-mobile-pending", JSON.stringify(pendingSend))
    if (pendingSend.grantId) sessionStorage.setItem("flapstack-mobile-pending:" + pendingSend.grantId, JSON.stringify(pendingSend))
  } else {
    sessionStorage.removeItem("flapstack-mobile-pending")
    if (activeGrantId) sessionStorage.removeItem("flapstack-mobile-pending:" + activeGrantId)
  }
}
function activateAccess(grantId) {
  if (activeGrantId === grantId) return
  navigationGeneration++
  saveDraft()
  storePending()
  selectedChat = null; selectedConversation = null; conversationBefore = null; newChat = false; newChatProject = ""
  $("messages").replaceChildren(); $("message").value = ""; $("activity").textContent = ""
  activeGrantId = grantId
  pendingSend = readJson(sessionStorage.getItem("flapstack-mobile-pending:" + grantId))
  storePending()
  $("send-status").textContent = ""
  resetSide(); renderReply()
}
let reconnectTimer = null
let reconnectAttempt = 0
let connectionGeneration = 0
let connectionDeadline = null
let reconnectPaused = sessionStorage.getItem("flapstack-mobile-reconnect-paused") === "true"
let lastMessageAt = 0
const drafts = readJson(sessionStorage.getItem("flapstack-mobile-drafts")) || {}
const draftKey = () => selectedChat ? selectedChat + ":" + (selectedConversation || "") : "new:" + activeGrantId + ":" + newChatProject
function saveDraft() {
  if ((!selectedChat && !newChat) || (selectedChat && !selectedConversation)) return
  drafts[draftKey()] = $("message").value
  sessionStorage.setItem("flapstack-mobile-drafts", JSON.stringify(drafts))
}
function renderReply() {
  const reply = replies[draftKey()]
  $("reply-preview").hidden = !reply || !selectedChat
  $("reply-text").textContent = reply ? (reply.role === "user" ? "You: " : "Flapstack: ") + reply.text.slice(0,220) : ""
}
function saveReplies() { sessionStorage.setItem("flapstack-mobile-replies", JSON.stringify(replies)); renderReply() }
$("remove-reply").addEventListener("click", () => { delete replies[draftKey()]; saveReplies() })
$("message").addEventListener("input", () => { saveDraft(); $("message").style.height = "auto"; $("message").style.height = Math.min($("message").scrollHeight,160) + "px" })
connection.addEventListener("click", () => { $("settings").open = !$("settings").open })
$("back").addEventListener("click", () => { navigationGeneration++; saveDraft(); selectedChat = null; selectedConversation = null; newChat = false; renderChats() })
$("new-chat").addEventListener("click", () => { navigationGeneration++; saveDraft(); selectedChat = null; selectedConversation = null; newChat = true; $("messages").replaceChildren(); renderChats(); $("message").value = drafts[draftKey()] || ""; $("message").focus() })
$("project").addEventListener("change", () => { navigationGeneration++; saveDraft(); newChatProject = $("project").value; $("message").value = drafts[draftKey()] || "" })
$("older").addEventListener("click", () => readConversation(conversationBefore))
$("conversation-select").addEventListener("change", () => { navigationGeneration++; saveDraft(); selectedConversation = $("conversation-select").value; conversationBefore = null; $("older").hidden = true; $("message").value = drafts[draftKey()] || ""; $("messages").replaceChildren(); readConversation() })
$("compose").addEventListener("submit", event => {
  event.preventDefault()
  const message = $("message").value.trim()
  if (!message || pendingSend || $("side-questions").open) return
  const target = selectedChat ? currentItems.get("chat:" + selectedChat) : currentItems.get("project:" + $("project").value)
  if (!target) return announce("Connect and choose an available project first.")
  const reply = selectedChat ? replies[draftKey()] : null
  const action = selectedChat ? {type:"chat.send", subChatId:selectedConversation, message, ...(reply ? {reply} : {})} : {type:"chat.create", harness:$("harness").value, message}
  if (selectedChat && !selectedConversation) return
  const commandId = sendCommand(target, action)
  if (commandId) {
    pendingSend = {commandId, navigationGeneration, grantId:activeGrantId, key:draftKey(), message, reply, create:!selectedChat, chatId:selectedChat, subChatId:selectedConversation}
    storePending()
    $("send-status").textContent = "Sending…"
    $("send").disabled = true
  }
})
function openChat(id) {
  navigationGeneration++
  saveDraft(); selectedChat = id; selectedConversation = null; conversationBefore = null; newChat = false
  $("message").value = ""; $("message").style.height = "auto"
  $("older").hidden = true; $("conversation-select").hidden = true
  $("messages").replaceChildren(); $("activity").textContent = "Loading…"
  renderChats(); $("back").focus(); readConversation()
}
function readConversation(before) {
  if (!selectedChat || !currentItems.has("chat:" + selectedChat) || !isMutable()) return
  socket.send(JSON.stringify({kind:"conversation.read",chatId:selectedChat,...(selectedConversation ? {subChatId:selectedConversation} : {}),...(typeof before === "number" ? {before} : {})}))
}
function renderChats() {
  renderReply(); syncSide()
  if (selectedChat && !snapshotPaging && !currentItems.has("chat:" + selectedChat)) {
    saveDraft(); navigationGeneration++; selectedChat = null; selectedConversation = null; conversationBefore = null
    $("messages").replaceChildren(); $("message").value = ""; $("activity").textContent = ""
    announce("This chat is no longer available in this access scope.")
    $("new-chat").focus()
  }
  $("new-chat").hidden = newChat
  $("back").hidden = !selectedChat && !newChat
  $("conversation").hidden = !selectedChat && !newChat
  $("compose").hidden = (!selectedChat && !newChat) || $("side-questions").open
  $("chat-list").hidden = !!selectedChat || newChat
  $("new-options").hidden = !newChat
  $("chat-title").textContent = selectedChat ? currentItems.get("chat:" + selectedChat)?.name || "Chat" : newChat ? "New chat" : "Chats"
  $("message").disabled = !!selectedChat && !selectedConversation
  $("new-chat").disabled = !isMutable() || (capabilities && !capabilities.includes("chat.create"))
  $("send").disabled = !isMutable() || !!pendingSend || (!!selectedChat && !selectedConversation) || (capabilities && !capabilities.includes(selectedChat ? "chat.send" : "chat.create"))
  const list = $("chat-list")
  list.replaceChildren()
  for (const item of currentItems.values()) if (item.kind === "chat") {
    const button = document.createElement("button"); button.textContent = item.name; button.addEventListener("click", () => openChat(item.id)); list.append(button)
  }
  if (!list.children.length) { const empty = document.createElement("p"); empty.className = "muted"; empty.textContent = online ? "Start a chat in a connected project." : "Connect your computer to see your chats."; list.append(empty) }
  const value = newChatProject || $("project").value
  $("project").replaceChildren()
  for (const item of currentItems.values()) if (item.kind === "project") { const option = document.createElement("option"); option.value = item.id; option.textContent = item.name; $("project").append(option) }
  if ([...$("project").options].some(option => option.value === value)) $("project").value = value
  if (newChatProject !== $("project").value) {
    saveDraft(); newChatProject = $("project").value
    if (newChat) $("message").value = drafts[draftKey()] || ""
  }
}
function readPendingConversation() {
  if (!pendingSend || !isMutable()) return
  socket.send(JSON.stringify({kind:"conversation.read",chatId:pendingSend.create ? "mobile-" + pendingSend.commandId : pendingSend.chatId,...(pendingSend.subChatId ? {subChatId:pendingSend.subChatId} : {})}))
}
function completeSend(sent) {
  pendingSend = null
  storePending()
  const matchesDraft = drafts[sent.key]?.trim() === sent.message
  if (matchesDraft) {
    delete drafts[sent.key]; sessionStorage.setItem("flapstack-mobile-drafts", JSON.stringify(drafts))
    if (draftKey() === sent.key) $("message").value = ""
  }
  if (matchesDraft && sent.reply && JSON.stringify(replies[sent.key]) === JSON.stringify(sent.reply)) { delete replies[sent.key]; saveReplies() }
  if (draftKey() === sent.key) $("send-status").textContent = "Sent"
  else announce("Your earlier message was saved on the host.")
  renderChats()
}
function applyConversation(value) {
  if (pendingSend && value.acceptedCommands?.includes(pendingSend.commandId)) {
    const sent = pendingSend
    const follow = sent.create && sent.navigationGeneration === navigationGeneration && newChat
    completeSend(sent)
    if (follow) {
      selectedChat = value.chatId; selectedConversation = value.subChatId; newChat = false
      $("message").value = drafts[draftKey()] || ""; $("send-status").textContent = "Sent"
    }
  }
  else if (pendingSend?.checking && value.chatId === (pendingSend.create ? "mobile-" + pendingSend.commandId : pendingSend.chatId) && (!pendingSend.subChatId || value.subChatId === pendingSend.subChatId) && ++pendingSend.checks >= 3) {
    pendingSend = null; storePending()
    $("send-status").textContent = "Delivery could not be confirmed. Your draft is kept; check the conversation before retrying."
    renderChats()
  }
  if (value.chatId !== selectedChat || (selectedConversation && value.subChatId !== selectedConversation)) return
  if (!selectedConversation) { selectedConversation = value.subChatId; $("message").value = drafts[draftKey()] || "" }
  renderChats()
  const select = $("conversation-select")
  select.replaceChildren()
  value.conversations.forEach((conversation, index) => { const option = document.createElement("option"); option.value = conversation.id; option.textContent = conversation.name || "Conversation " + (index + 1); select.append(option) })
  select.value = selectedConversation; select.hidden = value.conversations.length < 2
  if (value.pageBefore !== null || !$("messages").children.length) conversationBefore = value.before
  $("older").hidden = !conversationBefore
  const root = $("messages")
  const atBottom = window.innerHeight + window.scrollY >= document.body.scrollHeight - 160
  const fragment = document.createDocumentFragment()
  for (const message of value.messages) {
    let element = [...root.children].find(child => child.dataset.message === message.id)
    if (!element) { element = document.createElement("div"); element.dataset.message = message.id; element.className = "message " + message.role; element.setAttribute("aria-label", message.role === "user" ? "You" : "Flapstack"); fragment.append(element) }
    if (element.dataset.text !== message.text || element.dataset.reply !== JSON.stringify(message.reply)) {
      element.dataset.text = message.text; element.dataset.reply = JSON.stringify(message.reply); element.replaceChildren()
      const separator = message.text.indexOf("\n\n")
      const quoted = message.reply || (separator >= 0 ? parseMessageReply(message.text.slice(0,separator)) : null)
      const body = quoted && !message.reply ? message.text.slice(separator+2) : message.text
      if (quoted) { const quote = document.createElement("div"); quote.className = "reply-preview"; quote.textContent = (quoted.role === "user" ? "You: " : "Flapstack: ") + quoted.text.slice(0,220); element.append(quote) }
      const text = document.createElement("span"); text.textContent = body; element.append(text)
      const reply = document.createElement("button"); reply.type = "button"; reply.className = "reply-action"; reply.textContent = "Reply"; reply.setAttribute("aria-label", "Reply to " + (message.role === "user" ? "your message" : "Flapstack"))
      reply.addEventListener("click", () => { $("side-questions").open = false; syncSide(); replies[draftKey()] = {messageId: message.id, role: message.role, text: body}; saveReplies(); $("message").focus() })
      element.append(reply)
    }
  }
  if (value.pageBefore !== null) root.prepend(fragment); else root.append(fragment)
  if (value.status === "idle") for (const element of [...root.children]) if (element.dataset.message?.startsWith("live-")) element.remove()
  $("activity").textContent = value.status === "running" ? "Working…" : value.status === "pending" ? "Queued on your computer" : value.status === "failed" ? "The run failed on your computer. Your message was saved." : ""
  if (atBottom && value.pageBefore === null && !$("attention").open && !$("side-questions").open) $("compose").scrollIntoView?.({block:"end"})
}
setInterval(() => {
  if (document.visibilityState !== "visible") return
  if (online && !refreshPending && !snapshotPaging && Date.now() > freshUntil - 10000 && socket?.readyState === WebSocket.OPEN) { refreshPending = true; socket.send(JSON.stringify({kind:"snapshot.refresh"})) }
  if (online && Date.now() - lastMessageAt > 45000) { void connect(); return }
  readConversation()
  if (pendingSend?.checking) readPendingConversation()
  if ($("side-questions").open && !sideBusy) void refreshSide()
}, 2000)
window.addEventListener("online", () => connect())
function resumeConnection() {
  if (document.visibilityState === "visible" && sessionCredential && (!online || Date.now() - lastMessageAt > 10000)) void connect()
}
document.addEventListener("visibilitychange", resumeConnection)
window.addEventListener("pageshow", resumeConnection)

function updateBlockReason() {
  if (pairingBusy || sideBusy || sideRequests) return "Finish the current request before updating."
  if (pendingSend) return "Waiting for message delivery. Reconnect and check the conversation before updating."
  if (Object.values(controlCommands).some(command => command.status === "pending")) return "Waiting for a host receipt before updating."
  if ([...itemsRoot.querySelectorAll("textarea,input")].some(input => input.type === "checkbox" || input.type === "radio" ? input.checked : input.value.trim())) return "Finish or clear the activity form before updating."
  return ""
}
function renderUpdate() {
  const blocked = updateBlockReason()
  $("app-update").hidden = !waitingWorker && !updateNeedsReload && !updateError && !updateApplying
  $("reload-update").disabled = updateApplying || !!blocked
  const label = waitingWorker || updateNeedsReload ? "Reload to update" : "Check again"
  if ($("reload-update").textContent !== label) $("reload-update").textContent = label
  const message = updateApplying ? "Updating… Message and side-question drafts stay in this tab." : blocked || updateError || "Update ready. Message and side-question drafts stay in this tab. Reloading never confirms or resends an earlier action."
  if ($("update-status").textContent !== message) $("update-status").textContent = message
}
function failUpdate(message) {
  clearTimeout(updateTimer)
  updateApplying = false
  updateError = message
  render(); renderUpdate(); updatePairButton()
}
function finishUpdate() {
  if (!updateApplying) return
  if (updateBlockReason()) return failUpdate("Update ready. Finish the current request or activity form, then reload.")
  try { saveDraft(); storePending() } catch { return failUpdate("Could not keep your draft. Copy it before trying again.") }
  clearTimeout(updateTimer)
  location.reload()
}
async function watchUpdate() {
  try {
    const registration = await navigator.serviceWorker.register("/service-worker.js")
    const refresh = () => { waitingWorker = registration.waiting; renderUpdate() }
    const watch = () => { registration.installing?.addEventListener("statechange", refresh); refresh() }
    registration.addEventListener("updatefound", watch)
    updateError = ""; watch()
  } catch { updateError = "Could not check for an update. Try again."; renderUpdate() }
}
$("reload-update").addEventListener("click", () => {
  if (updateApplying || updateBlockReason()) return renderUpdate()
  if (!waitingWorker && !updateNeedsReload) return void watchUpdate()
  const unknown = Object.values(controlCommands).some(command => command.status === "unknown") || Object.values(sideDrafts).some(draft => draft.requestId) || Object.keys(sessionStorage).some(key => key.startsWith("flapstack-mobile-pending:"))
  if (unknown && !confirm("An earlier action has no confirmed outcome. Check it on your computer. Reload now without resending it?")) return
  try { saveDraft(); storePending() } catch { return failUpdate("Could not keep your draft. Copy it before trying again.") }
  updateApplying = true; updateError = ""
  render(); renderUpdate(); updatePairButton()
  if (updateNeedsReload) return finishUpdate()
  updateTimer = setTimeout(() => failUpdate("The update did not finish. Your drafts are kept. Try again."), 10000)
  try { waitingWorker.postMessage({type:"activate-update"}) } catch { failUpdate("The update could not start. Your drafts are kept. Try again.") }
})
if ("serviceWorker" in navigator) {
  const initialController = navigator.serviceWorker.controller
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!initialController && !updateApplying) return
    updateNeedsReload = true
    if (updateApplying) finishUpdate()
    else renderUpdate()
  })
  void watchUpdate()
}
if (offer) {
  $("fingerprint").textContent = "Certificate fingerprint: " + offer.certificateFingerprint
  updatePairButton()
}
$("pairing").hidden = !!sessionCredential && !offer
$("settings").open = !sessionCredential
connectButton.disabled = !sessionCredential
if (reconnectPaused) {
  announce("Access was revoked. Review this phone’s access on the computer before reconnecting.")
  $("settings").open = true
}
$("fingerprint-confirmed").addEventListener("change", updatePairButton)
$("device-name").addEventListener("input", updatePairButton)
grantInput.addEventListener("change", () => { void connect(true) })
pairButton.addEventListener("click", pair)
connectButton.addEventListener("click", () => { void connect(true) })
$("notifications").addEventListener("click", async () => {
  if (!("Notification" in window)) return announce("Notifications are unavailable in this browser.")
  const permission = await Notification.requestPermission()
  announce(permission === "granted" ? "Notifications are best effort and are now enabled while connected." : "Notifications were not enabled.")
})
window.addEventListener("offline", () => setOnline(false))
renderChats()
if (sessionCredential && !offer) void connect()
setInterval(() => {
  const now = Date.now()
  const approvalExpired = [...currentItems.values()].some((item) => item.kind === "approval" && item.expiresAt > lastExpiryCheck && item.expiresAt <= now)
  lastExpiryCheck = now
  updatePairButton()
  renderUpdate()
  if (Object.values(controlCommands).some(command => command.status === "pending" && now >= command.expiresAt)) render()
  if (online && Date.now() >= freshUntil) {
    render()
  } else if (approvalExpired) {
    render()
  }
}, 1000)

function updatePairButton() {
  pairButton.disabled = updateApplying || pairingBusy || !offer || Date.now() >= offer.expiresAt || !$("fingerprint-confirmed").checked || !$("device-name").value.trim()
}

async function pair() {
  if (updateApplying || pairingBusy || !$("fingerprint-confirmed").checked || !$("device-name").value.trim()) return
  if (!offer || Date.now() >= offer.expiresAt) return announce("Pairing offer expired. Create a fresh QR from desktop Flapstack.")
  pairingBusy = true
  connectionGeneration++
  clearTimeout(reconnectTimer); clearTimeout(connectionDeadline)
  const previousSocket = socket; socket = null; previousSocket?.close()
  setOnline(false)
  updatePairButton()
  $("fingerprint-confirmed").disabled = true
  $("device-name").disabled = true
  try {
    const keys = await crypto.subtle.generateKey({name:"ECDSA",namedCurve:"P-256"}, false, ["sign","verify"])
    const spki = await crypto.subtle.exportKey("spki", keys.publicKey)
    const paired = await post("/mobile/v1/pair", {
      protocolVersion: 1,
      oneTimeToken: offer.oneTimeToken,
      certificateFingerprint: offer.certificateFingerprint,
      deviceName: $("device-name").value,
      publicKeyAlgorithm: "P-256",
      publicKey: pem(spki),
    })
    const challengeProof = {
      sessionId: paired.challenge.sessionId,
      deviceId: paired.challenge.deviceId,
      challenge: paired.challenge.challenge,
    }
    const signature = await signText(await challengeMessage(challengeProof), keys.privateKey)
    const credential = await post("/mobile/v1/authenticate", {...challengeProof, signature})
    await storePrivateKey(keys.privateKey)
    localStorage.setItem("flapstack-mobile-session", JSON.stringify(credential))
    sessionCredential = credential
    history.replaceState(null, "", "/")
    $("pairing").hidden = true
    connectButton.disabled = false
    connectButton.focus()
    pairingBusy = false
    await connect(true)
  } catch {
    announce("Pairing failed safely. Confirm the fingerprint and create a fresh offer.")
  } finally {
    pairingBusy = false
    $("fingerprint-confirmed").disabled = false
    $("device-name").disabled = false
    updatePairButton()
  }
}

async function connect(manual = false) {
  if (pairingBusy) return
  if (manual) {
    reconnectPaused = false
    sessionStorage.removeItem("flapstack-mobile-reconnect-paused")
  }
  if (reconnectPaused) return
  const generation = ++connectionGeneration
  clearTimeout(reconnectTimer)
  clearTimeout(connectionDeadline)
  const privateKey = await readPrivateKey().catch(() => null)
  if (generation !== connectionGeneration) return
  if (!privateKey || !sessionCredential) return announce("Pair this phone with your computer first.")
  const old = socket; socket = null; if (old) old.close()
  setOnline(false)
  try {
    const challenge = await post("/mobile/v1/challenge", {deviceId:sessionCredential.session.deviceId})
    const unsigned = {sessionId:challenge.sessionId,deviceId:challenge.deviceId,challenge:challenge.challenge}
    const authenticated = await post("/mobile/v1/authenticate", {...unsigned,signature:await signText(await challengeMessage(unsigned),privateKey)})
    if (generation !== connectionGeneration) return
    sessionCredential = authenticated
    localStorage.setItem("flapstack-mobile-session", JSON.stringify(sessionCredential))
    const access = await post("/mobile/v1/grants", await sessionProof(sessionCredential, privateKey))
    if (generation !== connectionGeneration) return
    const previous = grantInput.value || localStorage.getItem("flapstack-mobile-grant")
    grantInput.replaceChildren()
    for (const grant of access.grants) {
      const option = document.createElement("option"); option.value = grant.grantId; option.textContent = grant.label; grantInput.append(option)
    }
    $("access-choice").hidden = access.grants.length < 2
    if (!access.grants.length) {
      localStorage.removeItem("flapstack-mobile-grant")
      announce("Waiting for access. Allow this phone a project on your computer.")
      $("settings").open = true
      reconnectTimer = setTimeout(connect, 5000)
      return
    }
    if (access.grants.some(grant => grant.grantId === previous)) grantInput.value = previous
    const grantId = grantInput.value
    activateAccess(grantId)
    localStorage.setItem("flapstack-mobile-grant", grantId)
    const proof = await sessionProof(sessionCredential, privateKey)
    if (generation !== connectionGeneration) return
    const next = new WebSocket((location.protocol === "https:" ? "wss:" : "ws:") + "//" + location.host + "/mobile/v1/events")
    socket = next
    connectionDeadline = setTimeout(() => { if (socket === next) { next.close(); void connect() } }, 15000)
    next.addEventListener("open", () => { if (socket === next) next.send(JSON.stringify({protocolVersion:1,kind:"subscribe",proof,authorityGrantId:grantId})) })
    next.addEventListener("message", event => { if (socket !== next) return; lastMessageAt = Date.now(); clearTimeout(connectionDeadline); try { const envelope = JSON.parse(event.data); if (envelope.kind === "snapshot") online = true; applyEnvelope(envelope) } catch { announce("Could not read the computer update. Reconnect to try again.") } })
    next.addEventListener("close", event => {
      if (socket !== next) return
      const interruptedSnapshot = snapshotPaging && event.reason === "invalid-snapshot-page"
      clearTimeout(connectionDeadline)
      setOnline(false)
      if (pendingSend) $("send-status").textContent = "Connection lost. Your draft is kept. Check the conversation before sending again."
      if (event.code === 1008 && !interruptedSnapshot && !["authorization-expired", "authorization-changed"].includes(event.reason)) { announce("Access changed. Check this phone’s access on your computer, then reconnect."); $("settings").open = true; return }
      reconnectTimer = setTimeout(connect, Math.min(30000, 1000 * 2 ** Math.min(reconnectAttempt++,5)))
    })
    next.addEventListener("error", () => { if (socket === next) setOnline(false) })
  } catch (error) {
    if (generation !== connectionGeneration) return
    if (["device-revoked", "device-not-found", "signature-invalid"].includes(error.message)) {
      setOnline(false)
      announce("This phone's pairing is no longer valid. Pair again from your computer.")
      $("settings").open = true
      return
    }
    announce("Computer unavailable. Check Tailscale and that Flapstack is open.")
    setOnline(false)
    reconnectTimer = setTimeout(connect, Math.min(30000, 1000 * 2 ** Math.min(reconnectAttempt++,5)))
  }
}

function applyEnvelope(envelope) {
  if (envelope.kind === "conversation") { applyConversation(envelope.conversation); return }
  if (envelope.kind === "snapshot") {
    refreshPending = false
    capabilities = envelope.capabilities || null
    if (!snapshotPaging) currentItems.clear()
    for (const item of envelope.items) currentItems.set(item.kind + ":" + item.id, item)
    snapshotPaging = !!envelope.nextCursor
    if (envelope.nextCursor) socket.send(JSON.stringify({protocolVersion:1,kind:"snapshot.page",cursor:envelope.nextCursor}))
    reconnectAttempt = 0
    connection.dataset.mode = "online"
    if (!receivedSnapshot) $("settings").open = false
    receivedSnapshot = true
    $("pairing-result").textContent = ""
    if (!snapshotPaging && pendingSend) {
      const chatId = pendingSend.create ? "mobile-" + pendingSend.commandId : pendingSend.chatId
      if (currentItems.has("chat:" + chatId)) {
        pendingSend.checking = true
        pendingSend.checks = 0
        freshUntil = envelope.freshUntil
        readPendingConversation()
      }
      else { pendingSend = null; storePending(); $("send-status").textContent = "Delivery could not be confirmed. Your draft is kept; check your chats before retrying." }
    }
    if (!snapshotPaging && selectedChat && !currentItems.has("chat:" + selectedChat)) {
      saveDraft()
      selectedChat = null; selectedConversation = null; conversationBefore = null; newChat = false
      $("messages").replaceChildren(); $("message").value = ""; $("activity").textContent = ""
    }
    if (!snapshotPaging && promotedChat && promotedChat.navigationGeneration === navigationGeneration && currentItems.has("chat:" + promotedChat.chatId)) {
      saveDraft(); selectedChat = promotedChat.chatId; selectedConversation = promotedChat.subChatId; newChat = false; promotedChat = null; $("messages").replaceChildren(); $("message").value = drafts[draftKey()] || ""; readConversation()
    }
    freshUntil = envelope.freshUntil
  } else if (envelope.kind === "event") {
    freshUntil = Date.now() + 30000
    if (envelope.payload.type === "entity.upsert") currentItems.set(envelope.payload.item.kind + ":" + envelope.payload.item.id, envelope.payload.item)
    if (envelope.payload.type === "entity.remove") currentItems.delete(envelope.payload.resource.kind + ":" + envelope.payload.resource.id)
    if (envelope.payload.type === "action.result") {
      if (pendingSend && envelope.payload.commandId === pendingSend.commandId) {
        const sent = pendingSend; pendingSend = null; storePending()
        if (envelope.payload.status === "completed") {
          completeSend(sent)
          if (sent.create && sent.navigationGeneration === navigationGeneration && draftKey() === sent.key) { promotedChat = {chatId:"mobile-" + sent.commandId, subChatId:null, navigationGeneration} }
          readConversation()
        } else if (draftKey() === sent.key) $("send-status").textContent = "Not sent. Your draft is kept. Check access and try again."
        else announce("Your earlier message was not sent. Its draft is kept; return to that conversation to retry.")
      } else {
        const command = Object.values(controlCommands).find(command => command.commandId === envelope.payload.commandId)
        if (command && command.action === envelope.payload.action) {
          command.status = envelope.payload.status
          command.summary = envelope.payload.summary || ""
          storeControls()
        }
      }
    }
    if (envelope.payload.type === "scope.revoked") {
      reconnectPaused = true
      sessionStorage.setItem("flapstack-mobile-reconnect-paused", "true")
      connectionGeneration++
      clearTimeout(reconnectTimer); clearTimeout(connectionDeadline)
      const revokedSocket = socket; socket = null
      saveDraft(); currentItems.clear(); setOnline(false)
      announce("Access was revoked. Review this phone’s access on the computer before reconnecting.")
      $("settings").open = true
      revokedSocket?.close(1000, "scope-revoked")
      return
    }
    if (envelope.payload.type === "resnapshot.required") {
      announce("State changed. Reconnect for a fresh snapshot.")
      socket.close(1012, "resnapshot-required")
    }
  }
  render()
}

function render() {
  for (const command of Object.values(controlCommands)) if (command.status === "pending" && (!online || Date.now() >= command.expiresAt)) { command.status = "unknown"; storeControls() }
  renderChats()
  if (online) connection.textContent = Date.now() < freshUntil ? "Online · current" : "State is stale · read-only"
  const focused = document.activeElement
  const focusedRow = focused?.closest("article")?.dataset.key
  const focusedLabel = focused?.tagName === "BUTTON" ? focused.textContent : null
  const savedInputs = new Map([...itemsRoot.children].map(row => [row.dataset.key, [...row.querySelectorAll("input,textarea")].map(input => ({value:input.value,checked:input.checked,focused:document.activeElement === input,start:input.selectionStart,end:input.selectionEnd}))]))
  itemsRoot.replaceChildren()
  for (const id of notificationAttempts.keys()) if (!currentItems.has("approval:" + id)) notificationAttempts.delete(id)
  for (const item of currentItems.values()) {
    if (item.kind === "chat" || item.kind === "project" || item.kind === "task") continue
    const row = document.createElement("article")
    row.className = "item"
    row.dataset.key = item.kind + ":" + item.id + ":" + item.version
    const title = document.createElement("strong")
    title.textContent = (item.name || item.action || item.label || item.kind) + " · " + item.kind
    row.append(title)
    if (item.status) {
      const status = document.createElement("p")
      status.className = "muted"
      status.textContent = "Status: " + item.status
      row.append(status)
    }
    const actions = document.createElement("div")
    actions.className = "actions"
    if (item.kind === "agent-input") renderClarification(row, item)
    if (item.kind === "run") {
      const steer = document.createElement("textarea")
      steer.id = "steer-" + item.id
      steer.maxLength = 10000
      steer.placeholder = "Send bounded steering to this active run"
      steer.setAttribute("aria-label", "Steering message for " + item.id)
      steer.disabled = !isMutable()
      row.append(steer)
      actions.append(actionButton("Steer", item, () => ({type:"run.steer",message:steer.value.trim()})))
      actions.append(actionButton("Pause", item, () => ({type:"run.pause"})))
      actions.append(actionButton("Resume", item, () => ({type:"run.resume"})))
      actions.append(actionButton("Cancel", item, () => ({type:"run.cancel"})))
    }
    if (item.kind === "orchestration") {
      actions.append(actionButton("Pause", item, () => ({type:"orchestration.pause"})))
      actions.append(actionButton("Resume", item, () => ({type:"orchestration.resume"})))
      actions.append(actionButton("Cancel", item, () => ({type:"orchestration.cancel"})))
    }
    if (item.kind === "automation") {
      actions.append(actionButton("Pause", item, () => ({type:"automation.pause"})))
      actions.append(actionButton("Resume", item, () => ({type:"automation.resume"})))
      actions.append(actionButton("Cancel", item, () => ({type:"automation.cancel"})))
    }
    if (item.kind === "approval" && Date.now() < item.expiresAt) {
      actions.append(actionButton("Approve", item, () => ({type:"approval.approve"})))
      actions.append(actionButton("Deny", item, () => ({type:"approval.deny"})))
      maybeNotify(item)
    }
    row.append(actions)
    const command = controlCommands[controlKey(item)]
    if (command) {
      const feedback = document.createElement("p")
      feedback.setAttribute("role", "status")
      feedback.tabIndex = -1
      feedback.textContent = command.status === "pending" ? "Waiting for host receipt. Do not send again." : command.status === "unknown" ? "Delivery is unknown. Check the host before retrying; this action may have run." : "Host receipt: " + command.status + (command.summary ? ". " + command.summary : "")
      row.append(feedback)
    }
    if (item.kind === "approval" || item.kind === "orchestration" || item.kind === "run" || item.kind === "automation") {
      const safety = document.createElement("p")
      safety.className = "muted"
      safety.textContent = "Approve and cancel require device confirmation followed by a fresh desktop step-up token."
      row.append(safety)
    }
    itemsRoot.append(row)
    const saved = savedInputs.get(row.dataset.key)
    if (saved) [...row.querySelectorAll("input,textarea")].forEach((input,index) => { const previous = saved[index]; if (!previous) return; input.value = previous.value; input.checked = previous.checked; if (previous.focused) { input.focus({preventScroll:true}); if (typeof previous.start === "number" && (input.tagName === "TEXTAREA" || input.type === "text")) input.setSelectionRange(previous.start,previous.end) } })
  }
  if (focusedRow && document.activeElement === document.body) {
    const row = [...itemsRoot.children].find(row => row.dataset.key === focusedRow)
    const next = row && [...row.querySelectorAll("button")].find(button => button.textContent === focusedLabel && !button.disabled)
    if (next) next.focus({preventScroll:true})
    else if (row?.querySelector('[role="status"]')) row.querySelector('[role="status"]').focus({preventScroll:true})
    else $("attention").querySelector("summary").focus({preventScroll:true})
  }
  if (!currentItems.size) itemsRoot.innerHTML = '<p class="muted">No authorized work is available.</p>'
}

function renderClarification(row, item) {
  const form = document.createElement("form")
  form.addEventListener("submit", (event) => {
    event.preventDefault()
    const answers = {}
    for (const question of item.questions) {
      const selected = [...form.querySelectorAll('[name="' + cssEscape(question.id) + '"]:checked')].map((input) => input.value)
      const custom = form.querySelector('[data-custom="' + cssEscape(question.id) + '"]')
      if (custom && custom.value.trim()) { if (!question.multiSelect) selected.length = 0; selected.push(custom.value.trim()) }
      if (!selected.length) return announce("Answer each question before sending.")
      if (selected.length) answers[question.id] = selected
    }
    sendCommand(item, {type:"clarification.answer",requestId:item.id,answers})
  })
  for (const question of item.questions) {
    const fieldset = document.createElement("fieldset")
    const legend = document.createElement("legend")
    legend.textContent = question.question
    fieldset.append(legend)
    question.options.forEach((option, index) => {
      const label = document.createElement("label")
      const input = document.createElement("input")
      input.type = question.multiSelect ? "checkbox" : "radio"
      input.name = question.id
      input.value = option
      input.disabled = !isMutable()
      label.append(input, document.createTextNode(" " + option))
      fieldset.append(label)
    })
    if (question.allowCustom) {
      const label = document.createElement("label")
      label.textContent = "Custom answer"
      const input = document.createElement("input")
      input.type = "text"
      input.maxLength = 4000
      input.dataset.custom = question.id
      input.disabled = !isMutable()
      label.append(input)
      fieldset.append(label)
    }
    form.append(fieldset)
  }
  const submit = document.createElement("button")
  submit.type = "submit"
  submit.textContent = "Answer all questions"
  submit.disabled = !isMutable() || controlCommands[controlKey(item)]?.status === "pending" || (capabilities && !capabilities.includes("clarification.answer"))
  form.append(submit)
  row.append(form)
}

function cssEscape(value) {
  return window.CSS && CSS.escape ? CSS.escape(value) : value.replace(/[^a-zA-Z0-9_-]/g, "\\\\$&")
}

function actionButton(label, target, createAction) {
  const button = document.createElement("button")
  button.textContent = label
  button.disabled = !isMutable() || controlCommands[controlKey(target)]?.status === "pending" || (capabilities && !capabilities.includes(createAction().type))
  button.addEventListener("click", () => {
    const action = createAction()
    if (action.type === "run.steer" && !action.message) return announce("Enter a steering message first.")
    sendCommand(target, action)
  })
  return button
}

function isMutable() {
  return !updateApplying && online && !snapshotPaging && Date.now() < freshUntil && socket && socket.readyState === WebSocket.OPEN
}

function sendCommand(target, action) {
  if (updateApplying) return announce("The companion is updating. Wait before sending an action.")
  if (!isMutable()) return announce("State is stale or offline. Cached data is read-only.")
  if (capabilities && !capabilities.includes(action.type)) return announce("Allow this action in your phone’s access settings on the computer first.")
  const previous = controlCommands[controlKey(target)]
  if (!action.type.startsWith("chat.") && previous?.status === "pending") return
  if (!action.type.startsWith("chat.") && !confirm((previous?.status === "unknown" ? "Delivery is unknown. Check the host before retrying. " : "") + "Confirm " + action.type + " for this exact " + target.kind + "?")) return
  if (!isMutable() || currentItems.get(target.kind + ":" + target.id) !== target || (target.kind === "approval" && Date.now() >= target.expiresAt)) return announce("This action expired or changed. Review the current work.")
  const now = Date.now()
  const privileged = ["run.cancel","orchestration.cancel","automation.cancel","approval.approve"].includes(action.type)
  const stepUpToken = $("step-up-token").value.trim()
  if (privileged && !stepUpToken) return announce("Create and enter a fresh desktop step-up token first.")
  const command = {
    protocolVersion:1, kind:"command", commandId:crypto.randomUUID(),
    sessionId:sessionCredential.session.sessionId, deviceId:sessionCredential.session.deviceId,
    authorityGrantId:grantInput.value.trim(), nonce:randomNonce(), issuedAt:now,
    expiresAt:now + 30000, scopeVersion:sessionCredential.session.scopeVersion,
    deviceConfirmedAt:now,
    ...(privileged ? {stepUpToken} : {}),
    target:{kind:target.kind,id:target.id,version:target.version}, action
  }
  // Wire contract marker used by static audits: {"kind":"command"}
  try { socket.send(JSON.stringify(command)) } catch {
    announce("Connection failed. Delivery is unknown. Check the host before retrying; your draft is kept.")
    setOnline(false)
    return
  }
  if (!action.type.startsWith("chat.")) {
    controlCommands[controlKey(target)] = {commandId:command.commandId,action:action.type,status:"pending",expiresAt:command.expiresAt}
    const keys = Object.keys(controlCommands)
    for (const key of keys.slice(0, Math.max(0,keys.length - 100))) if (controlCommands[key].status !== "pending") delete controlCommands[key]
    storeControls(); render()
  }
  if (privileged) $("step-up-token").value = ""
  return command.commandId
}

function setOnline(value) {
  online = value
  if (!value) { freshUntil = 0; snapshotPaging = false; refreshPending = false; receivedSnapshot = false }
  connection.dataset.mode = value ? "online" : "offline"
  connection.textContent = value ? "Online · current" : "Offline · read-only"
  render()
}

function announce(message) {
  $("pairing-result").textContent = message
}

function maybeNotify(item) {
  if (isMutable() && "Notification" in window && Notification.permission === "granted" && notificationAttempts.get(item.id) !== item.version) {
    notificationAttempts.set(item.id, item.version)
    try { new Notification("Approval needs attention", {body: item.action + ". Delivery is best effort."}) } catch { announce("Notification delivery failed. Check the attention cards here.") }
  }
}

function resetSide() {
  sideGeneration++; sideKey = ""; sideEntries = []; sideBefore = null; sideBusy = false
  $("side-questions").open = false; $("side-messages").replaceChildren(); $("side-message").value = ""; $("side-status").textContent = ""
}
function syncSide() {
  const key = selectedChat && selectedConversation ? activeGrantId + ":" + draftKey() : ""
  if (key !== sideKey) { resetSide(); sideKey = key; $("side-message").value = sideDrafts[key]?.question || "" }
  $("side-questions").hidden = !key
  $("compose").hidden = (!selectedChat && !newChat) || $("side-questions").open
  $("side-send").disabled = !key || !isMutable() || sideBusy || (capabilities && !capabilities.includes("chat.send"))
}
async function sideRequest(request) {
  sideRequests++
  try {
    if (!isMutable() || !selectedChat || !selectedConversation) throw new Error("Reconnect to ask a question.")
    const context = {grantId: activeGrantId, chatId: selectedChat, subChatId: selectedConversation}
    const generation = sideGeneration
    const privateKey = await readPrivateKey()
    const proof = await sessionProof(sessionCredential, privateKey)
    if (generation !== sideGeneration) throw new Error("Conversation changed.")
    if (updateApplying) throw new Error("The companion is updating.")
    const result = await post("/mobile/v1/side-questions", {proof, request: {...context, ...request}})
    if (generation !== sideGeneration) throw new Error("Conversation changed.")
    return result
  } finally { sideRequests-- }
}
function renderSide() {
  const root = $("side-messages"); root.replaceChildren()
  for (const entry of sideEntries) {
    const item = document.createElement("div"); item.className = "side-entry"
    const question = document.createElement("strong"); question.textContent = entry.question; item.append(question)
    const answer = document.createElement("p"); answer.textContent = entry.answer || (entry.status === "running" ? "Thinking…" : entry.status === "cancelled" ? "Stopped" : entry.error || "No answer"); item.append(answer)
    const actions = document.createElement("div"); actions.className = "actions"
    const add = (label, operation) => { const button = document.createElement("button"); button.type = "button"; button.textContent = label; button.disabled = sideBusy || !isMutable(); button.onclick = () => void changeSide({operation, id:entry.id}); actions.append(button) }
    if (entry.status === "running") add("Stop", "cancel")
    if (entry.status === "failed" || entry.status === "cancelled") add("Retry", "retry")
    if (entry.status === "completed" && (!capabilities || capabilities.includes("chat.create"))) add("Open as chat", "promote")
    item.append(actions); root.append(item)
  }
  $("side-older").hidden = !sideBefore
  syncSide()
}
async function refreshSide(before) {
  if (!sideKey || !$("side-questions").open || !isMutable() || sideBusy) return
  const generation = sideGeneration; sideBusy = true; renderSide()
  try {
    const result = await sideRequest({operation:"list", ...(typeof before === "number" ? {before} : {})})
    if (generation !== sideGeneration) return
    const incoming = new Map(result.entries.map(entry => [entry.id,entry]))
    sideEntries = [...sideEntries.filter(entry => !incoming.has(entry.id)), ...result.entries].sort((a,b) => a.createdAt-b.createdAt)
    sideBefore = result.before; renderSide()
  } catch { if (generation === sideGeneration) $("side-status").textContent = "Could not load side questions. Reconnect and try again." }
  finally { if (generation === sideGeneration) { sideBusy = false; renderSide() } }
}
async function changeSide(request) {
  if (sideBusy) return
  const generation = sideGeneration, key = sideKey
  sideBusy = true; renderSide(); $("side-status").textContent = ""
  try {
    const result = await sideRequest(request)
    if (generation !== sideGeneration) return
    if (result.entry) {
      sideEntries = [...sideEntries.filter(entry => entry.id !== result.entry.id), result.entry].sort((a,b) => a.createdAt-b.createdAt)
      if (request.operation === "ask" && $("side-message").value.trim() === request.question) { $("side-message").value = ""; delete sideDrafts[key]; sessionStorage.setItem("flapstack-mobile-side-drafts", JSON.stringify(sideDrafts)) }
    }
    if (result.chatId) { promotedChat = {...result,navigationGeneration}; socket.send(JSON.stringify({kind:"snapshot.refresh"})); $("side-status").textContent = "Opening chat…" }
    renderSide()
  } catch { if (generation === sideGeneration) $("side-status").textContent = "Could not complete that action. Your question is kept; try again." }
  finally { if (generation === sideGeneration) { sideBusy = false; renderSide() } }
}
$("side-questions").addEventListener("toggle", () => { syncSide(); if ($("side-questions").open) void refreshSide() })
$("side-older").addEventListener("click", () => void refreshSide(sideBefore))
$("side-message").addEventListener("input", () => { sideDrafts[sideKey] = {question: $("side-message").value}; sessionStorage.setItem("flapstack-mobile-side-drafts", JSON.stringify(sideDrafts)) })
$("side-form").addEventListener("submit", async event => {
  event.preventDefault()
  const question = $("side-message").value.trim()
  if (!question || !sideKey || sideBusy) return
  const key = sideKey, generation = sideGeneration
  const saved = sideDrafts[key]
  let request = saved?.requestId && saved.question === question ? saved : {operation:"ask", question, requestId:crypto.randomUUID()}
  sideDrafts[key] = request; sessionStorage.setItem("flapstack-mobile-side-drafts", JSON.stringify(sideDrafts))
  sideBusy = true; renderSide()
  try {
    const current = await sideRequest({operation:"list", requestId:request.requestId})
    if (generation !== sideGeneration) return
    if (!current.accepted) {
      const latest = current.entries.at(-1)
      request = {operation:"ask", question, requestId:request.requestId, ...(latest?.threadId && !latest.promotedChatId ? {threadId:latest.threadId} : {})}
      sideDrafts[key] = request; sessionStorage.setItem("flapstack-mobile-side-drafts", JSON.stringify(sideDrafts))
    }
    sideBusy = false
    await changeSide(request)
  } catch { if (generation === sideGeneration) $("side-status").textContent = "Could not check delivery. Your question is kept; try again." }
  finally { if (generation === sideGeneration) { sideBusy = false; renderSide() } }
})

async function post(path, body) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15000)
  try {
    const response = await fetch(path, {method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body),signal:controller.signal})
    const value = await response.json()
    if (!response.ok) throw new Error(value?.error?.code || "mobile-request-failed")
    return value
  } finally { clearTimeout(timeout) }
}

async function sessionProof(credential, privateKey) {
  const session = credential.session
  const unsigned = {
    sessionId:session.sessionId, deviceId:session.deviceId, sessionToken:credential.sessionToken,
    nonce:randomNonce(), issuedAt:Date.now(), rotation:session.rotation
  }
  return {...unsigned, signature:await signText(await sessionMessage(unsigned), privateKey)}
}

async function challengeMessage(value) {
  return "flapstack-mobile-challenge-v1\n" + value.sessionId + "\n" + value.deviceId + "\n" + await sha256(value.challenge)
}

async function sessionMessage(value) {
  return ["flapstack-mobile-session-v1",value.sessionId,value.deviceId,await sha256(value.sessionToken),await sha256(value.nonce),String(value.issuedAt),String(value.rotation)].join("\n")
}

async function signText(value, privateKey) {
  const raw = new Uint8Array(await crypto.subtle.sign({name:"ECDSA",hash:"SHA-256"}, privateKey, new TextEncoder().encode(value)))
  return base64url(ecdsaRawToDer(raw))
}

async function sha256(value) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2,"0")).join("")
}

function ecdsaRawToDer(raw) {
  const integer = (bytes) => {
    let start = 0
    while (start < bytes.length - 1 && bytes[start] === 0) start++
    let value = bytes.slice(start)
    if (value[0] & 0x80) value = Uint8Array.from([0,...value])
    return Uint8Array.from([2,value.length,...value])
  }
  const r = integer(raw.slice(0, raw.length / 2))
  const s = integer(raw.slice(raw.length / 2))
  return Uint8Array.from([0x30,r.length+s.length,...r,...s])
}

function pem(buffer) {
  const body = btoa(String.fromCharCode(...new Uint8Array(buffer))).match(/.{1,64}/g).join("\n")
  return "-----BEGIN PUBLIC KEY-----\n" + body + "\n-----END PUBLIC KEY-----"
}
function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"")
}
function randomNonce() { return base64url(crypto.getRandomValues(new Uint8Array(32))) }
function readJson(value) { try { return value ? JSON.parse(value) : null } catch { return null } }
function readOffer() {
  try {
    const encoded = new URL(location.href).searchParams.get("pair")
    if (!encoded) return null
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(encoded.replace(/-/g,"+").replace(/_/g,"/")), c => c.charCodeAt(0))))
  } catch { return null }
}
function openKeyDb() {
  return new Promise((resolve,reject) => {
    const request = indexedDB.open("flapstack-mobile",1)
    request.onupgradeneeded = () => request.result.createObjectStore("credentials")
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
async function storePrivateKey(key) {
  const db = await openKeyDb()
  try {
    await new Promise((resolve,reject) => {
      const transaction = db.transaction("credentials","readwrite")
      transaction.oncomplete = resolve
      transaction.onabort = () => reject(transaction.error || new Error("Could not save pairing key"))
      transaction.onerror = () => reject(transaction.error)
      transaction.objectStore("credentials").put(key,"device-private-key")
    })
  } finally { db.close() }
}
async function readPrivateKey() {
  const db = await openKeyDb()
  const value = await new Promise((resolve,reject) => {
    const request = db.transaction("credentials").objectStore("credentials").get("device-private-key")
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  db.close()
  return value
}
`

const manifestBody = JSON.stringify({
  name: "Flapstack",
  short_name: "Flapstack",
  start_url: "/",
  scope: "/",
  display: "standalone",
  background_color: "#f7f7f5",
  theme_color: "#171717",
  description: "Chat with Flapstack on your computer over your private network.",
})

const serviceWorkerBody = `
const CACHE = "mobile-companion-v4"
const ASSETS = ["/", "/mobile-app.js", "/manifest.webmanifest"]
self.addEventListener("install", (event) => event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS))))
self.addEventListener("activate", (event) => event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("mobile-companion-") && key !== CACHE).map((key) => caches.delete(key))))))
self.addEventListener("message", (event) => {
  if (event.data?.type === "activate-update") event.waitUntil(self.skipWaiting())
})
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return
  const url = new URL(event.request.url)
  if (url.origin !== self.location.origin || url.searchParams.has("pair") || !ASSETS.includes(url.pathname)) return
  event.respondWith(fetch(event.request).catch(async (error) => {
    const match = await (await caches.open(CACHE)).match(url.pathname)
    if (match) return match
    throw error
  }))
})
`

const assets: Record<string, MobileCompanionAsset> = {
  "/": { status: 200, contentType: "text/html; charset=utf-8", body: documentBody },
  "/mobile-app.js": {
    status: 200,
    contentType: "text/javascript; charset=utf-8",
    body: applicationBody,
  },
  "/manifest.webmanifest": {
    status: 200,
    contentType: "application/manifest+json; charset=utf-8",
    body: manifestBody,
  },
  "/service-worker.js": {
    status: 200,
    contentType: "text/javascript; charset=utf-8",
    body: serviceWorkerBody,
  },
}

export function getMobileCompanionAsset(pathname: string): MobileCompanionAsset | null {
  return assets[pathname] ?? null
}
