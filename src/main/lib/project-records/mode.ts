export function projectRecordsEnabled(env = process.env): boolean {
  return Boolean(
    env.FLAPSTACK_PROJECT_RECORDS_URL ||
    env.FLAPSTACK_PROJECT_RECORDS_MODE ||
    env.FLAPSTACK_PROJECT_RECORDS_TOKEN ||
    env.FLAPSTACK_PROJECT_RECORDS_TOKEN_FILE,
  )
}
