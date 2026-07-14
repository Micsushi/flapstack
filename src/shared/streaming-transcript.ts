export type StreamingTranscriptUpdate = {
  committed: string
  tentative: string
}

export class StreamingTranscriptState {
  private committed = ""

  apply(update: Partial<StreamingTranscriptUpdate>): StreamingTranscriptUpdate {
    const committed = cleanTranscript(update.committed ?? "")
    const tentative = cleanTranscript(update.tentative ?? "")
    if (this.committed && !committed.startsWith(this.committed)) {
      throw new Error("Streaming STT committed text regressed")
    }
    this.committed = committed
    return { committed, tentative }
  }
}

export function composeDictationDraft(
  initialDraft: string,
  committed: string,
  tentative = "",
): string {
  const speech = [cleanTranscript(committed), cleanTranscript(tentative)].filter(Boolean).join(" ")
  return `${initialDraft}${initialDraft && speech && !/\s$/.test(initialDraft) ? " " : ""}${speech}`
}

function cleanTranscript(text: string): string {
  return text
    .replace(/[\r\n\t]+/g, " ")
    .replace(/ +/g, " ")
    .trim()
}
