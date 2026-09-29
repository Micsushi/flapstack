import { readFileSync, readdirSync, writeFileSync } from "node:fs"
import { gzipSync } from "node:zlib"
import { execFileSync } from "node:child_process"
import { resolve, join } from "node:path"
import { fileURLToPath } from "node:url"

const source = process.env.FLAPSTACK_PROJECT_RECORDS_SOURCE
if (!source)
  throw new Error("Set FLAPSTACK_PROJECT_RECORDS_SOURCE to the reviewed Records checkout.")
const repo = resolve(source)
const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim()
const names = readdirSync(repo).filter(
  (name) => name.endsWith(".py") || name.endsWith("_prompt.txt"),
)
const ui = readdirSync(join(repo, "ui"), { recursive: true, withFileTypes: true })
for (const entry of ui) {
  if (entry.isFile())
    names.push(
      join(entry.parentPath, entry.name)
        .slice(repo.length + 1)
        .replaceAll("\\", "/"),
    )
}
if (git("status", "--porcelain", "--", ...names))
  throw new Error("Commit the reviewed runtime before syncing.")
const files = Object.fromEntries(
  names.map((name) => [name, readFileSync(join(repo, name), "utf8").replace(/\r\n/g, "\n")]),
)
writeFileSync(
  fileURLToPath(new URL("../resources/project-records-runtime.json.gz", import.meta.url)),
  gzipSync(JSON.stringify({ revision: git("rev-parse", "HEAD"), files }), { level: 9 }),
)
console.log(`Pinned Project Records runtime from ${git("rev-parse", "HEAD")}`)
