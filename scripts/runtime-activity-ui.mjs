import { spawn } from "node:child_process"
import { createRequire } from "node:module"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

const require = createRequire(import.meta.url)
const output =
  process.env.FLAPSTACK_TIMELINE_FIXTURE_OUTPUT ??
  resolve(".local-evidence/runtime-timeline-ui", `${Date.now()}-${process.pid}`)
mkdirSync(output, { recursive: true })

{
  const { build } = await import("esbuild")
  const postcss = (await import("postcss")).default
  const tailwind = (await import("tailwindcss")).default
  const autoprefixer = (await import("autoprefixer")).default
  await build({
    entryPoints: ["tests/fixtures/runtime-activity-ui.tsx"],
    outfile: resolve(output, "fixture.js"),
    bundle: true,
    platform: "browser",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' },
  })
  const cssPath = resolve("src/renderer/styles/globals.css")
  const css = readFileSync(cssPath, "utf8").replace(
    '@import "./agents-styles.css";',
    readFileSync(resolve("src/renderer/styles/agents-styles.css"), "utf8"),
  )
  const rendered = await postcss([
    tailwind(require(resolve("tailwind.config.js"))),
    autoprefixer,
  ]).process(css, { from: cssPath })
  writeFileSync(resolve(output, "fixture.css"), rendered.css)
  writeFileSync(
    resolve(output, "index.html"),
    '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="fixture.css"></head><body><div id="root"></div><script src="fixture.js"></script></body></html>',
  )
  const env = { ...process.env, FLAPSTACK_TIMELINE_FIXTURE_OUTPUT: output }
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(
    require("electron"),
    [resolve("tests/fixtures/runtime-activity-ui-main.cjs")],
    {
      env,
      stdio: "inherit",
      windowsHide: true,
    },
  )
  const deadline = setTimeout(() => child.kill(), 60_000)
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject)
    child.once("close", resolve)
  })
  clearTimeout(deadline)
  writeFileSync(
    resolve(output, "cleanup.json"),
    JSON.stringify({
      exitCode: code,
      signal: child.signalCode,
      exited: child.exitCode !== null || child.signalCode !== null,
    }),
  )
  if (code !== 0) throw new Error(`Runtime timeline UI fixture failed (${code})`)
}
