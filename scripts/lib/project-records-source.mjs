import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import path from "node:path"

// Project Records is the editable source. CI and clean checkouts use its pinned
// generated snapshot; an explicit path opts into companion-repo development.
export function prepareProjectRecordsSource(root) {
  const entries = ["board.js", "board.d.ts", "template.js", "setups.js", "yap.js"]
  const target = path.join(root, ".generated", "project-records")
  const configured = process.env.FLAPSTACK_PROJECT_RECORDS_SOURCE
  mkdirSync(target, { recursive: true })
  let provenance
  if (configured) {
    const shared = path.resolve(root, configured, "ui", "shared")
    for (const entry of entries) {
      if (!existsSync(path.join(shared, entry)))
        throw new Error(`Missing Project Records UI: ${entry} in ${shared}`)
    }
    cpSync(shared, target, { recursive: true })
    provenance = { source: shared }
  } else {
    const snapshot = JSON.parse(
      gunzipSync(readFileSync(path.join(root, "resources", "project-records-ui.json.gz"))).toString(
        "utf8",
      ),
    )
    for (const entry of entries) {
      if (typeof snapshot.files[entry] !== "string")
        throw new Error(`Missing bundled Project Records UI: ${entry}`)
      writeFileSync(path.join(target, entry), snapshot.files[entry])
    }
    provenance = { source: "bundled-project-records", revision: snapshot.revision }
  }
  writeFileSync(path.join(target, "source.json"), JSON.stringify(provenance) + "\n")
  return target
}
