/**
 * Renderer analytics facade.
 *
 * No hosted SDK runs in a renderer. Consented events cross IPC and are
 * validated again by the main process immediately before emission.
 */

import type { ChatMode } from "../../shared/chat-mode"

let consentGranted = false
let lifecycleGeneration = 0
let initialization: Promise<void> | null = null

async function getMainConsent(): Promise<boolean> {
  try {
    return (await window.desktopApi?.getAnalyticsConsent()) === true
  } catch {
    return false
  }
}

async function initializeAnalytics(generation: number): Promise<void> {
  const granted = await getMainConsent()
  if (generation !== lifecycleGeneration) return
  consentGranted = granted
}

export function initAnalytics(): Promise<void> {
  if (initialization) return initialization
  const generation = lifecycleGeneration
  const pending = initializeAnalytics(generation).finally(() => {
    if (initialization === pending) initialization = null
  })
  initialization = pending
  return pending
}

export async function capture(
  eventName: string,
  properties?: Record<string, unknown>,
): Promise<void> {
  if (!consentGranted) return
  const generation = lifecycleGeneration
  if (!(await getMainConsent()) || generation !== lifecycleGeneration) {
    await shutdown()
    return
  }
  try {
    await window.desktopApi?.captureAnalyticsEvent(eventName, properties)
  } catch {
    // Telemetry is best-effort and must not affect product behavior.
  }
}

export function identify(userId: string, traits?: Record<string, unknown>): void {
  void userId
  void traits
}

export function getCurrentUserId(): string | null {
  return null
}

export function reset(): void {
  // Hosted analytics has no renderer identity or persistent client state.
}

export async function shutdown(): Promise<void> {
  lifecycleGeneration += 1
  consentGranted = false
  initialization = null
}

/** Apply a main-process broadcast and invalidate any stale consent request. */
export async function syncAnalyticsConsent(granted: boolean): Promise<void> {
  await shutdown()
  if (granted) await initAnalytics()
}

export function trackMessageSent(data: {
  workspaceId: string
  messageLength: number
  mode: ChatMode
}): void {
  void data.workspaceId
  void data.messageLength
  void capture("message_sent", { mode: data.mode })
}
