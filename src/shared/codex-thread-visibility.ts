export const CODEX_THREAD_VISIBILITIES = ["hidden", "project"] as const

export type CodexThreadVisibility = (typeof CODEX_THREAD_VISIBILITIES)[number]
