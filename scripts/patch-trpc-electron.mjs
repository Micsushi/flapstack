import { createRequire } from "node:module"
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const marker = "/* flapstack: preserve native async iterator disposal */"

export function patchTrpcElectron(source) {
  if (source.includes(marker)) return source
  const guard =
    /if\s*\(t\[Symbol\.asyncDispose\]\)\s*throw new Error\("Symbol\.asyncDispose already exists"\);/g
  const matches = [...source.matchAll(guard)]
  if (matches.length !== 1)
    throw new Error("Unexpected trpc-electron async disposal implementation")
  // This helper is used only by iteratorResource. Native iterators already own
  // disposal; replacing it would lose their cleanup or call return twice.
  return source.replace(guard, `if (t[Symbol.asyncDispose]) return t; ${marker}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const require = createRequire(import.meta.url)
  const directory = dirname(require.resolve("trpc-electron/main"))
  const outputs = ["main.cjs", "main.mjs"].map((name) => {
    const file = join(directory, name)
    return { file, source: patchTrpcElectron(readFileSync(file, "utf8")) }
  })
  for (const { file, source } of outputs) writeFileSync(file, source)
}
