export const SLEEP_PREVENTION_MODES = ["off", "automatic", "on"] as const
export type SleepPreventionMode = (typeof SLEEP_PREVENTION_MODES)[number]

export type SleepPreventionStatus = {
  mode: SleepPreventionMode
  active: boolean
  agentWork: boolean
  terminals: number
  error: string | null
}
