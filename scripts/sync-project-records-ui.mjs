import { readFileSync, writeFileSync } from "node:fs"
import { gzipSync } from "node:zlib"
import { execFileSync } from "node:child_process"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const source = process.env.FLAPSTACK_PROJECT_RECORDS_SOURCE
if (!source)
  throw new Error("Set FLAPSTACK_PROJECT_RECORDS_SOURCE to the reviewed companion checkout.")
const repo = resolve(source)
const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim()
if (git("status", "--porcelain", "--", "ui/shared"))
  throw new Error("Commit the reviewed shared UI before syncing.")
const files = Object.fromEntries(
  ["board.js", "board.d.ts", "template.js", "setups.js", "yap.js"].map((name) => [
    name,
    readFileSync(resolve(repo, "ui/shared", name), "utf8").replace(/\r\n/g, "\n"),
  ]),
)
const output = fileURLToPath(new URL("../resources/project-records-ui.json.gz", import.meta.url))
writeFileSync(
  output,
  gzipSync(JSON.stringify({ revision: git("rev-parse", "HEAD"), files }), { level: 9 }),
)
console.log(`Pinned Project Records UI from ${git("rev-parse", "HEAD")}`)
