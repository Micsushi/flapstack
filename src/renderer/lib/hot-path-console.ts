const profilingEnabled = import.meta.env.VITE_PROFILE_HOT_PATHS === "true"

export const hotPathConsole = {
  log: profilingEnabled ? globalThis.console.log.bind(globalThis.console) : () => undefined,
  warn: globalThis.console.warn.bind(globalThis.console),
  error: globalThis.console.error.bind(globalThis.console),
}
