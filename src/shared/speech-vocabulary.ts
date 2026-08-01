export const MAX_SPEECH_VOCABULARY_TERMS = 12
export const MAX_SPEECH_VOCABULARY_TERM_LENGTH = 64

export type SpeechVocabularySource = "project" | "task" | "chat"

export type SelectedSpeechContext = {
  project?: string | null
  task?: string | null
  chat?: string | null
}

export type SpeechVocabularyTerm = {
  source: SpeechVocabularySource
  value: string
}

export type VocabularyAwareSpeechAdapter = {
  kind: "cloud" | "local" | "os"
  supportsVocabularyHints: boolean
}

export function buildSelectedSpeechVocabulary(
  context: SelectedSpeechContext | null | undefined,
): SpeechVocabularyTerm[] {
  if (!context) return []
  const seen = new Set<string>()
  const terms: SpeechVocabularyTerm[] = []
  for (const source of ["project", "task", "chat"] as const) {
    const value = normalizeSpeechVocabularyTerm(context[source])
    const key = value.toLocaleLowerCase("en")
    if (!value || seen.has(key)) continue
    seen.add(key)
    terms.push({ source, value })
    if (terms.length === MAX_SPEECH_VOCABULARY_TERMS) break
  }
  return terms
}

export function resolveSpeechVocabularyHints(
  adapter: VocabularyAwareSpeechAdapter,
  terms: readonly SpeechVocabularyTerm[],
  options: { allowCloudSelectedContext?: boolean } = {},
): string[] {
  if (!adapter.supportsVocabularyHints) return []
  if (adapter.kind === "cloud" && options.allowCloudSelectedContext !== true) return []
  return terms.slice(0, MAX_SPEECH_VOCABULARY_TERMS).map((term) => term.value)
}

function normalizeSpeechVocabularyTerm(value: string | null | undefined): string {
  if (!value) return ""
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_SPEECH_VOCABULARY_TERM_LENGTH)
}
