#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { resolve } from "node:path"
import { gzipSync } from "node:zlib"

const root = resolve(import.meta.dirname, "..")
const rendererDirectory = resolve(root, "out", "renderer")
const assetsDirectory = resolve(rendererDirectory, "assets")
const htmlPath = resolve(rendererDirectory, "index.html")

if (!existsSync(htmlPath)) {
  throw new Error("Renderer build is missing. Run npm run build first.")
}

const html = readFileSync(htmlPath, "utf8")
const entryName = /src=["']\.\/assets\/(index-[^"']+\.js)["']/.exec(html)?.[1]
if (!entryName) throw new Error("Could not identify the renderer entry chunk.")

const entryPath = resolve(assetsDirectory, entryName)
const entrySource = readFileSync(entryPath)
const javascript = readdirSync(assetsDirectory).filter((name) => name.endsWith(".js"))
const dynamicImports = [
  ...entrySource.toString("utf8").matchAll(/import\(["']\.\/([^"']+\.js)["']\)/g),
].map((match) => match[1])

const report = {
  schemaVersion: 1,
  entry: {
    name: entryName,
    bytes: entrySource.byteLength,
    gzipBytes: gzipSync(entrySource).byteLength,
  },
  javascript: {
    chunks: javascript.length,
    bytes: javascript.reduce(
      (total, name) => total + statSync(resolve(assetsDirectory, name)).size,
      0,
    ),
  },
  entryDynamicImports: [...new Set(dynamicImports)].sort(),
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
