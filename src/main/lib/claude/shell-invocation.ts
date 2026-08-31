export const CLAUDE_ENV_DELIMITER = "_CLAUDE_ENV_DELIMITER_"

export function buildLoginShellInvocation(shell: string): { file: string; args: string[] } {
  const command = `echo -n "${CLAUDE_ENV_DELIMITER}"; env; echo -n "${CLAUDE_ENV_DELIMITER}"; exit`
  return { file: shell, args: ["-ilc", command] }
}
