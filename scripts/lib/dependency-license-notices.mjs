import { createHash } from "node:crypto"
import {
  copyFileSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import path from "node:path"

const MIT_LICENSE_TEXT = `MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`

const ISC_LICENSE_TEXT = `ISC License

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
`

const LGPL_3_OR_LATER_SHA256 = "996af0513df21f7496288951c41428a03c174e9e4a9d63665c57d670f845ccb1"

function referencedNotice(license) {
  const match = /^SEE LICENSE IN (.+)$/i.exec(String(license || ""))
  if (!match) return null
  const notice = match[1].replaceAll("\\", "/")
  if (
    path.posix.isAbsolute(notice) ||
    notice.split("/").some((part) => part === ".." || part === "")
  ) {
    throw new Error(`Unsafe dependency license notice path: ${notice}`)
  }
  return notice
}

export function prepareDependencyLicenseNotices(options = {}) {
  const root = path.resolve(options.root ?? process.cwd())
  const generatedRoot = path.join(root, "build", "generated")
  const outputRoot = path.resolve(
    options.outputRoot ?? path.join(generatedRoot, "dependency-licenses"),
  )
  if (!outputRoot.startsWith(`${generatedRoot}${path.sep}`)) {
    throw new Error("Dependency license notice output must stay within build/generated")
  }
  const lock =
    options.lock ?? JSON.parse(readFileSync(path.join(root, "package-lock.json"), "utf8"))
  const overrides =
    options.overrides ??
    JSON.parse(readFileSync(path.join(root, "build", "dependency-license-overrides.json"), "utf8"))
  const textOverrides =
    options.textOverrides ??
    JSON.parse(
      readFileSync(path.join(root, "build", "dependency-license-text-overrides.json"), "utf8"),
    )
  if (textOverrides.schemaVersion !== 1 || typeof textOverrides.packages !== "object") {
    throw new Error("Dependency license text override schema is missing or unsupported")
  }
  rmSync(outputRoot, { recursive: true, force: true })
  mkdirSync(outputRoot, { recursive: true })
  const staged = []
  const dependencies = []
  for (const [location, value] of Object.entries(lock.packages ?? {})) {
    if (!location.startsWith("node_modules/") || value.dev) continue
    const name = location.slice("node_modules/".length)
    const packageRoot = path.resolve(root, ...location.split("/"))
    try {
      const packageStat = lstatSync(packageRoot)
      if (packageStat.isSymbolicLink() || !packageStat.isDirectory()) {
        throw new Error(`${name}: installed dependency must be a real directory`)
      }
    } catch (error) {
      if (error?.code === "ENOENT") continue
      throw error
    }
    const license = value.license || overrides[`${name}@${value.version}`] || overrides[name]
    if (!license) throw new Error(`${name}: installed production dependency has no license`)
    const notice = referencedNotice(license)
    let sourceFiles = notice
      ? [{ name: notice, sourceKind: "declared-notice" }]
      : readdirSync(packageRoot)
          .filter((entry) => /^(?:licen[cs]e|copying|notice)(?:\..*)?$/i.test(entry))
          .sort()
          .map((entry) => ({ name: entry, sourceKind: "package-license" }))
    const files = []
    if (sourceFiles.length === 0) {
      const key = `${name}@${value.version}`
      const textOverride = textOverrides.packages[key]
      if (!textOverride) {
        throw new Error(
          `${name}: installed dependency has no distributable license text or vetted full-text override`,
        )
      }
      if (String(textOverride.declaredLicense).toUpperCase() !== String(license).toUpperCase()) {
        throw new Error(`${key}: vetted license text does not match the declared license`)
      }
      const notice = String(textOverride.copyright || "").trim()
      const source = String(textOverride.source || "").trim()
      if (!notice) {
        throw new Error(`${key}: vetted license text override requires a copyright notice`)
      }
      if (!/^https:\/\/\S+$/.test(source)) {
        throw new Error(`${key}: vetted license text override requires an HTTPS source`)
      }
      const template = String(textOverride.template || "").toUpperCase()
      let licenseText
      if (template === "APACHE-2.0") {
        licenseText = readFileSync(path.join(root, "LICENSE"), "utf8")
        if (!/Apache License\s+Version 2\.0/i.test(licenseText) || licenseText.length < 9_000) {
          throw new Error(`${key}: checked-in Apache-2.0 license text is incomplete`)
        }
      } else if (template === "MIT") {
        licenseText = MIT_LICENSE_TEXT
      } else if (template === "ISC") {
        licenseText = ISC_LICENSE_TEXT
      } else if (template === "LGPL-3.0-OR-LATER") {
        licenseText = readFileSync(
          path.join(root, "build", "dependency-license-texts", "LGPL-3.0-or-later.txt"),
          "utf8",
        ).replaceAll("\r\n", "\n")
        const licenseTextSha256 = createHash("sha256").update(licenseText).digest("hex")
        if (
          !/GNU LESSER GENERAL PUBLIC LICENSE\s+Version 3/i.test(licenseText) ||
          !/GNU GENERAL PUBLIC LICENSE\s+Version 3/i.test(licenseText) ||
          licenseTextSha256 !== LGPL_3_OR_LATER_SHA256
        ) {
          throw new Error(
            `${key}: checked-in LGPL-3.0-or-later license text does not match the vetted SPDX text`,
          )
        }
      } else {
        throw new Error(`${key}: vetted license text override uses an unsupported template`)
      }
      const relativeOutput = `${name}/VETTED-LICENSE.txt`
      const destination = path.join(outputRoot, ...relativeOutput.split("/"))
      mkdirSync(path.dirname(destination), { recursive: true })
      const contents = [
        `Package: ${key}`,
        `Declared license: ${license}`,
        `Vetted source: ${source}`,
        notice,
        "",
        licenseText.trim(),
        "",
      ]
        .filter((line, index) => line || index >= 4)
        .join("\n")
      writeFileSync(destination, contents)
      const sha256 = createHash("sha256").update(contents).digest("hex")
      staged.push(relativeOutput)
      files.push({ path: relativeOutput, sha256, sourceKind: "vetted-full-text-override" })
    } else {
      for (const sourceFile of sourceFiles) {
        const source = path.resolve(root, ...location.split("/"), ...sourceFile.name.split("/"))
        if (!source.startsWith(`${packageRoot}${path.sep}`)) {
          throw new Error(`${name}: dependency license notice escapes its package directory`)
        }
        const stat = lstatSync(source)
        if (stat.isSymbolicLink() || !stat.isFile()) {
          throw new Error(`${name}: dependency license notice must be a regular file`)
        }
        const relativeOutput = `${name}/${sourceFile.name}`
        const destination = path.join(outputRoot, ...relativeOutput.split("/"))
        mkdirSync(path.dirname(destination), { recursive: true })
        copyFileSync(source, destination)
        const sha256 = createHash("sha256").update(readFileSync(destination)).digest("hex")
        staged.push(relativeOutput)
        files.push({ path: relativeOutput, sha256, sourceKind: sourceFile.sourceKind })
      }
    }
    dependencies.push({
      name,
      version: String(value.version ?? "unknown"),
      declaredLicense: String(license),
      files,
    })
  }
  dependencies.sort((left, right) => left.name.localeCompare(right.name))
  writeFileSync(
    path.join(outputRoot, "manifest.json"),
    `${JSON.stringify({ schemaVersion: 1, dependencies }, null, 2)}\n`,
  )
  return staged.sort()
}
