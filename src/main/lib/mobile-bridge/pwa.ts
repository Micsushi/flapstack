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
    <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
    <meta name="theme-color" content="#0034ff">
    <link rel="manifest" href="/manifest.webmanifest">
    <title>Flapstack Companion</title>
    <style>
      :root{font:14px/1.45 system-ui,sans-serif;color:#141414;background:#f7f7f5}
      *{box-sizing:border-box}body{margin:0}main{max-width:48rem;margin:auto;padding:1rem}
      header{display:flex;align-items:center;justify-content:space-between;gap:1rem}
      h1{font-size:1.25rem}h2{font-size:1rem}section{margin:1rem 0;padding:1rem;background:#fff;border:1px solid #ddd;border-radius:.5rem}
      label{display:block;margin:.5rem 0}input,textarea,button{font:inherit;min-height:2.75rem;border-radius:.4rem;border:1px solid #aaa;padding:.6rem}
      input[type="text"],textarea{width:100%}textarea{min-height:5rem}button{background:#0034ff;color:white;border-color:#0034ff}button:disabled{background:#ddd;color:#666;border-color:#ccc}
      .muted{color:#666}.danger{color:#a40000}.item{padding:.75rem 0;border-top:1px solid #eee}.item:first-child{border-top:0}
      .actions{display:flex;flex-wrap:wrap;gap:.5rem}.actions button{min-height:2.5rem}
      #connection[data-mode="offline"]{color:#a35a00}#connection[data-mode="online"]{color:#086b36}
      @media(prefers-color-scheme:dark){:root{color:#eee;background:#111}section{background:#191919;border-color:#333}.muted{color:#aaa}.item{border-color:#333}input{background:#111;color:#eee}}
      @media(prefers-color-scheme:dark){#connection[data-mode="offline"]{color:#ffb86b}#connection[data-mode="online"]{color:#72d99a}}
    </style>
  </head>
  <body>
    <main>
      <header><h1>Flapstack Companion</h1><strong id="connection" data-mode="offline" role="status" aria-live="polite" aria-atomic="true">Offline · read-only</strong></header>
      <p class="muted">This companion controls only explicitly granted Flapstack work on your private network.</p>
      <section id="pairing">
        <h2>Pair this device</h2>
        <p id="fingerprint" class="muted">Open a fresh QR pairing link from desktop Flapstack.</p>
        <label><input id="fingerprint-confirmed" type="checkbox"> I confirmed this certificate fingerprint on the desktop.</label>
        <label>Device name <input id="device-name" maxlength="120" value="Mobile browser"></label>
        <button id="pair-device" disabled>Pair device</button>
        <p id="pairing-result" role="status"></p>
      </section>
      <section>
        <h2>Authorized work</h2>
        <label>Authority grant ID <input id="grant-id" autocomplete="off"></label>
        <label>Desktop step-up token <input id="step-up-token" autocomplete="off" maxlength="512" aria-describedby="step-up-help"></label>
        <p id="step-up-help" class="muted">Privileged approve or cancel actions require a fresh one-time token created on the desktop.</p>
        <div class="actions">
          <button id="connect" disabled>Connect</button>
          <button id="notifications" type="button">Enable notifications</button>
        </div>
        <p class="muted">Notifications are best effort while this companion is connected. Delivery is never guaranteed.</p>
        <div id="items"><p class="muted">No current snapshot. Offline cached data is read-only.</p></div>
      </section>
    </main>
    <script type="module" src="/mobile-app.js"></script>
  </body>
</html>`

const applicationBody = String.raw`
const $ = (id) => document.getElementById(id)
const connection = $("connection")
const pairButton = $("pair-device")
const connectButton = $("connect")
const grantInput = $("grant-id")
const itemsRoot = $("items")
let offer = readOffer()
let socket = null
let sessionCredential = readJson(localStorage.getItem("flapstack-mobile-session"))
let currentItems = new Map()
let online = false
let freshUntil = 0

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/service-worker.js").catch(() => undefined)
}
if (offer) {
  $("fingerprint").textContent = "Certificate fingerprint: " + offer.certificateFingerprint
  pairButton.disabled = false
}
grantInput.value = localStorage.getItem("flapstack-mobile-grant") || ""
connectButton.disabled = !sessionCredential || !grantInput.value
$("fingerprint-confirmed").addEventListener("change", updatePairButton)
grantInput.addEventListener("input", () => {
  localStorage.setItem("flapstack-mobile-grant", grantInput.value.trim())
  connectButton.disabled = !sessionCredential || !grantInput.value.trim()
})
pairButton.addEventListener("click", pair)
connectButton.addEventListener("click", connect)
$("notifications").addEventListener("click", async () => {
  if (!("Notification" in window)) return announce("Notifications are unavailable in this browser.")
  const permission = await Notification.requestPermission()
  announce(permission === "granted" ? "Notifications are best effort and are now enabled while connected." : "Notifications were not enabled.")
})
window.addEventListener("offline", () => setOnline(false))
setInterval(() => {
  if (online && Date.now() >= freshUntil) {
    connection.textContent = "State is stale · read-only"
    render()
  }
}, 1000)

function updatePairButton() {
  pairButton.disabled = !offer || !$("fingerprint-confirmed").checked
}

async function pair() {
  if (!offer || Date.now() >= offer.expiresAt) return announce("Pairing offer expired. Create a fresh QR from desktop Flapstack.")
  pairButton.disabled = true
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
    await storePrivateKey(keys.privateKey)
    const challengeProof = {
      sessionId: paired.challenge.sessionId,
      deviceId: paired.challenge.deviceId,
      challenge: paired.challenge.challenge,
    }
    const signature = await signText(await challengeMessage(challengeProof), keys.privateKey)
    sessionCredential = await post("/mobile/v1/authenticate", {...challengeProof, signature})
    localStorage.setItem("flapstack-mobile-session", JSON.stringify(sessionCredential))
    history.replaceState(null, "", "/")
    announce("Device paired. Assign an authority grant on the desktop, then connect.")
    connectButton.disabled = !grantInput.value.trim()
  } catch {
    announce("Pairing failed safely. Confirm the fingerprint and create a fresh offer.")
    pairButton.disabled = false
  }
}

async function connect() {
  const privateKey = await readPrivateKey()
  const grantId = grantInput.value.trim()
  if (!privateKey || !sessionCredential || !grantId) return announce("Pair again or enter the authority grant shown on the desktop.")
  if (socket) socket.close()
  const proof = await sessionProof(sessionCredential, privateKey)
  const protocol = location.protocol === "https:" ? "wss:" : "ws:"
  socket = new WebSocket(protocol + "//" + location.host + "/mobile/v1/events")
  socket.addEventListener("open", () => {
    socket.send(JSON.stringify({protocolVersion:1,kind:"subscribe",proof,authorityGrantId:grantId}))
    setOnline(true)
  })
  socket.addEventListener("message", (event) => applyEnvelope(JSON.parse(event.data)))
  socket.addEventListener("close", () => setOnline(false))
  socket.addEventListener("error", () => setOnline(false))
}

function applyEnvelope(envelope) {
  if (envelope.kind === "snapshot") {
    currentItems = new Map(envelope.items.map((item) => [item.kind + ":" + item.id, item]))
    freshUntil = envelope.freshUntil
  } else if (envelope.kind === "event") {
    freshUntil = Date.now() + 30000
    if (envelope.payload.type === "entity.upsert") currentItems.set(envelope.payload.item.kind + ":" + envelope.payload.item.id, envelope.payload.item)
    if (envelope.payload.type === "entity.remove") currentItems.delete(envelope.payload.resource.kind + ":" + envelope.payload.resource.id)
    if (envelope.payload.type === "action.result") announce("Mobile action " + envelope.payload.status + ".")
    if (envelope.payload.type === "resnapshot.required") {
      announce("State changed. Reconnect for a fresh snapshot.")
      socket.close(1012, "resnapshot-required")
    }
  }
  render()
}

function render() {
  itemsRoot.replaceChildren()
  for (const item of currentItems.values()) {
    const row = document.createElement("article")
    row.className = "item"
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
      maybeNotify("Approval needs attention", item.action)
    }
    row.append(actions)
    if (item.kind === "approval" || item.kind === "orchestration" || item.kind === "run" || item.kind === "automation") {
      const safety = document.createElement("p")
      safety.className = "muted"
      safety.textContent = "Approve and cancel require device confirmation followed by a fresh desktop step-up token."
      row.append(safety)
    }
    itemsRoot.append(row)
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
      if (custom && custom.value.trim()) selected.push(custom.value.trim())
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
  submit.disabled = !isMutable()
  form.append(submit)
  row.append(form)
}

function cssEscape(value) {
  return window.CSS && CSS.escape ? CSS.escape(value) : value.replace(/[^a-zA-Z0-9_-]/g, "\\\\$&")
}

function actionButton(label, target, createAction) {
  const button = document.createElement("button")
  button.textContent = label
  button.disabled = !isMutable()
  button.addEventListener("click", () => {
    const action = createAction()
    if (action.type === "run.steer" && !action.message) return announce("Enter a steering message first.")
    sendCommand(target, action)
  })
  return button
}

function isMutable() {
  return online && Date.now() < freshUntil && socket && socket.readyState === WebSocket.OPEN
}

function sendCommand(target, action) {
  if (!isMutable()) return announce("State is stale or offline. Cached data is read-only.")
  if (!confirm("Confirm " + action.type + " for this exact " + target.kind + "?")) return
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
  socket.send(JSON.stringify(command))
  if (privileged) $("step-up-token").value = ""
}

function setOnline(value) {
  online = value
  connection.dataset.mode = value ? "online" : "offline"
  connection.textContent = value ? "Online · current" : "Offline · read-only"
  render()
}

function announce(message) {
  $("pairing-result").textContent = message
}

function maybeNotify(title, body) {
  if (online && "Notification" in window && Notification.permission === "granted") {
    try { new Notification(title, {body: body + ". Delivery is best effort."}) } catch {}
  }
}

async function post(path, body) {
  const response = await fetch(path, {method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)})
  const value = await response.json()
  if (!response.ok) throw new Error(value?.error?.code || "mobile-request-failed")
  return value
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
  await new Promise((resolve,reject) => {
    const request = db.transaction("credentials","readwrite").objectStore("credentials").put(key,"device-private-key")
    request.onsuccess = resolve
    request.onerror = () => reject(request.error)
  })
  db.close()
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
  name: "Flapstack Companion",
  short_name: "Flapstack",
  start_url: "/",
  scope: "/",
  display: "standalone",
  background_color: "#f7f7f5",
  theme_color: "#0034ff",
  description: "Private-network monitoring and bounded control for Flapstack work.",
})

const serviceWorkerBody = `
const CACHE = "mobile-companion-v1"
const ASSETS = ["/", "/mobile-app.js", "/manifest.webmanifest"]
self.addEventListener("install", (event) => event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS))))
self.addEventListener("activate", (event) => event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))))
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return
  const url = new URL(event.request.url)
  if (url.searchParams.has("pair")) return
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request).then((match) => match || caches.match("/"))))
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
