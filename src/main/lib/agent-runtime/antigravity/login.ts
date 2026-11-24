import { spawn } from "node:child_process"
import { mkdtempSync } from "node:fs"
import { rmdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createInterface } from "node:readline"
import { openExternalSafe } from "../../open-external"
import { childHarnessEnvironment } from "../../mcp-control/child-registration"
import { antigravityIntegration, resolveAntigravityBinary } from "./adapter"

type Login = {
  id: string
  child: ReturnType<typeof spawn>
  state: "starting" | "waiting" | "verifying" | "connected" | "unconfirmed" | "error"
  url?: string
}

let login: Login | undefined

function publicStatus(current: Login) {
  return { state: current.state, canOpenBrowser: Boolean(current.url) }
}

function isActive(current: Login) {
  return ["starting", "waiting", "verifying"].includes(current.state)
}

function matching(id: string) {
  if (login?.id !== id) throw new Error("Antigravity sign-in has ended. Start sign-in again.")
  return login
}

function googleSignInUrl(line: string) {
  const candidate = line.match(/https:\/\/accounts\.google\.com\/[^\s<>"']+/i)?.[0]
  if (!candidate || candidate.length > 8192) return
  const url = URL.parse(candidate)
  if (url?.origin === "https://accounts.google.com" && url.pathname.startsWith("/o/oauth2/"))
    return url.href
}

export function beginAntigravityLogin(id: string) {
  if (login && isActive(login)) throw new Error("Antigravity sign-in is already in progress.")
  const binary = resolveAntigravityBinary()
  if (!binary) throw new Error("Install the Antigravity CLI to sign in.")
  const cwd = mkdtempSync(join(tmpdir(), "flapstack-agy-login-"))
  const env = childHarnessEnvironment(process.env)
  delete env.DISPLAY
  delete env.WAYLAND_DISPLAY
  const child = spawn(binary, ["--login"], { cwd, env, windowsHide: true, stdio: "pipe" })
  const current: Login = { id, child, state: "starting" }
  login = current

  const timeout = setTimeout(() => {
    if (isActive(current)) {
      current.state = "unconfirmed"
      child.kill()
    }
  }, 240_000)
  function observe(line: string) {
    if (login !== current || current.url || current.state !== "starting") return
    const url = googleSignInUrl(line)
    if (!url) return
    current.url = url
    current.state = "waiting"
    void openExternalSafe(url).catch(() => undefined)
  }
  for (const output of [child.stdout, child.stderr]) {
    createInterface({ input: output }).on("line", observe)
  }
  child.stdin.on("error", () => {
    if (isActive(current)) current.state = "unconfirmed"
  })
  child.on("error", () => {
    if (isActive(current)) current.state = "error"
  })
  child.once("close", async (code) => {
    clearTimeout(timeout)
    void rmdir(cwd).catch(() => undefined)
    if (login !== current || !isActive(current)) return
    if (code !== 0) {
      current.state = "unconfirmed"
      return
    }
    current.state = "verifying"
    current.state =
      (await antigravityIntegration()).state === "connected" ? "connected" : "unconfirmed"
  })
  return publicStatus(current)
}

export function antigravityLoginStatus(id: string) {
  return publicStatus(matching(id))
}

export function submitAntigravityCode(id: string, code: string) {
  const current = matching(id)
  if (current.state !== "waiting") throw new Error("Antigravity is not waiting for a code.")
  current.state = "verifying"
  current.child.stdin?.end(code + "\n")
  return publicStatus(current)
}

export async function reopenAntigravityLogin(id: string) {
  const current = matching(id)
  if (current.state !== "waiting" || !current.url) throw new Error("Google sign-in is not ready.")
  await openExternalSafe(current.url)
}

export function cancelAntigravityLogin(id: string) {
  if (login?.id !== id) return
  if (isActive(login)) login.child.kill()
  login = undefined
}
