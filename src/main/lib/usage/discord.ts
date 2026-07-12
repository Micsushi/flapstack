// Stage 2 Track B - U10: Discord webhook sender.
//
// Ports onWatch `internal/notify/discord.go`. The webhook URL is a credential:
// it is never logged, never included in raw payloads, and never put into the
// persisted delivery-error text. Delivery outcome is returned to the caller so
// it can be persisted as a usage_alert_event.

export interface DiscordAlert {
  title: string
  body: string
  /** Decorative embed color (int). */
  color?: number
}

export interface DiscordSendResult {
  ok: boolean
  /** HTTP status when a response was received. */
  status?: number
  /** Sanitized error message - guaranteed free of the webhook URL. */
  error?: string
}

const DEFAULT_TIMEOUT_MS = 10_000

/**
 * Post an alert to a Discord webhook. Uses global fetch (Node 18+ / Electron).
 * Errors are sanitized so the secret URL never leaks into logs or the DB.
 */
export async function sendDiscordAlert(
  webhookUrl: string,
  alert: DiscordAlert,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<DiscordSendResult> {
  if (
    !webhookUrl ||
    !/^https:\/\/(discord\.com|discordapp\.com)\/api\/webhooks\//.test(webhookUrl)
  ) {
    return { ok: false, error: "Invalid Discord webhook URL" }
  }
  const payload = {
    embeds: [
      {
        title: alert.title.slice(0, 256),
        description: alert.body.slice(0, 4096),
        color: alert.color ?? 0x5865f2,
        timestamp: new Date().toISOString(),
      },
    ],
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    if (!res.ok) {
      return { ok: false, status: res.status, error: `Discord webhook returned ${res.status}` }
    }
    return { ok: true, status: res.status }
  } catch (err) {
    // Sanitize: strip any accidental URL occurrence from the message.
    const raw = String((err as Error)?.message ?? err)
    const sanitized = raw.split(webhookUrl).join("[webhook]")
    return { ok: false, error: sanitized }
  } finally {
    clearTimeout(timer)
  }
}
