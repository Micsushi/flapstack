export const LOCAL_MODEL_DEV_FIXTURE_VERSION = "flapstack-dev-fixture-v1"
export const LOCAL_MODEL_DEV_FIXTURE_CHAT_MODEL = "flapstack-dev-fixture-chat:1"
export const LOCAL_MODEL_DEV_FIXTURE_TOOLS_MODEL = "flapstack-dev-fixture-tools:1"

export const LOCAL_MODEL_DEV_FIXTURE_ENDPOINTS = {
  ready: "http://127.0.0.1:43127",
  empty: "http://127.0.0.1:43128",
  unavailable: "http://127.0.0.1:43129",
  error: "http://127.0.0.1:43130",
  stale: "http://127.0.0.1:43131",
} as const

export type LocalModelDevFixtureState = keyof typeof LOCAL_MODEL_DEV_FIXTURE_ENDPOINTS

export const LOCAL_MODEL_DEV_FIXTURE_STATES = Object.entries(
  LOCAL_MODEL_DEV_FIXTURE_ENDPOINTS,
) as Array<[LocalModelDevFixtureState, string]>

export function localModelDevFixtureStateForEndpoint(
  endpoint: string,
): LocalModelDevFixtureState | null {
  const match = LOCAL_MODEL_DEV_FIXTURE_STATES.find(([, value]) => value === endpoint)
  return match?.[0] ?? null
}
