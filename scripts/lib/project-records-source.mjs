import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"

// The desktop bundles the same UI as the standalone service. Generated copies
// are build inputs, never another editable source of workflow behavior.
export function prepareProjectRecordsSource(root) {
  const source = path.resolve(
    root,
    process.env.FLAPSTACK_PROJECT_RECORDS_SOURCE || "../project-records",
  )
  const shared = path.join(source, "ui", "shared")
  for (const entry of ["board.js", "board.d.ts", "template.js", "setups.js", "yap.js"]) {
    if (!existsSync(path.join(shared, entry))) {
      throw new Error(
        `Project Records UI is missing at ${shared}. Set FLAPSTACK_PROJECT_RECORDS_SOURCE to its repository before building.`,
      )
    }
  }
  const target = path.join(root, ".generated", "project-records")
  mkdirSync(target, { recursive: true })
  cpSync(shared, target, { recursive: true })
  writeFileSync(path.join(target, "source.json"), JSON.stringify({ source: shared }) + "\n")
  return target
}
