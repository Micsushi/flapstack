export type TimestampedMessage = {
  id?: string
  createdAt?: Date | string
  metadata?: Record<string, unknown>
}

export function getMessageDate(message: TimestampedMessage): Date | null {
  const candidates = [message.createdAt, message.metadata?.createdAt, message.metadata?.timestamp]

  for (const candidate of candidates) {
    if (!(candidate instanceof Date) && typeof candidate !== "string") continue
    const date = candidate instanceof Date ? candidate : new Date(candidate)
    if (!Number.isNaN(date.getTime())) return date
  }

  const idTimestamp = message.id?.match(/^msg-(\d{13})(?:\D|$)/)?.[1]
  if (idTimestamp) return new Date(Number(idTimestamp))

  return null
}

export function formatMessageTimestamp(
  message: TimestampedMessage,
  now = new Date(),
): string | null {
  const date = getMessageDate(message)
  if (!date) return null

  const isToday =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()

  return new Intl.DateTimeFormat(undefined, {
    ...(isToday ? {} : { year: "numeric", month: "short", day: "numeric" }),
    hour: "numeric",
    minute: "2-digit",
  }).format(date)
}
