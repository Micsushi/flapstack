import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { validateWithArchify } from "../scripts/archify-validate.mjs"

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture(mode = "success") {
  const root = mkdtempSync(path.join(tmpdir(), "flapstack-archify-test-"))
  roots.push(root)
  const workspaceRoot = path.join(root, "space 雪 & workspace")
  mkdirSync(workspaceRoot)
  const inputPath = path.join(workspaceRoot, "diagram ; input.json")
  writeFileSync(inputPath, JSON.stringify({ mode }))
  const cliPath = path.join(root, "fake archify.mjs")
  writeFileSync(
    cliPath,
    `
    import { readFileSync } from 'node:fs';
    const [command, type, input, flag] = process.argv.slice(2);
    if (command !== 'validate' || flag !== '--json' || process.argv.length !== 6) process.exit(9);
    if (process.env.FLAPSTACK_ADAPTER_TEST_SECRET) process.exit(8);
    const {mode} = JSON.parse(readFileSync(input, 'utf8'));
    if(mode === 'hang') setInterval(() => {}, 1000);
    else if(mode === 'overflow') process.stdout.write('x'.repeat(1024 * 1024 + 1));
    else if(mode === 'malformed') console.log('{}');
    else {
      const receipt = {schemaVersion:1, command, type, input, ok: mode !== 'failure',
        checks:[{ok:mode !== 'bad-check'}], composition:{summary:{errors:0}}};
      if(mode === 'wrong-input') receipt.input += '.other';
      if(mode === 'failure') { receipt.error = 'Invalid diagram'; process.exitCode = 1; }
      if(mode === 'contradiction') process.exitCode = 1;
      console.log(JSON.stringify(receipt));
    }
  `,
  )
  return { workspaceRoot, inputPath, cliPath, kind: "architecture" }
}

describe("Archify validation adapter", () => {
  it("runs the explicit CLI without shell interpolation or inherited provider secrets", async () => {
    const before = process.env.FLAPSTACK_ADAPTER_TEST_SECRET
    process.env.FLAPSTACK_ADAPTER_TEST_SECRET = "synthetic-test-value"
    try {
      expect(await validateWithArchify(fixture())).toMatchObject({ ok: true, command: "validate" })
    } finally {
      if (before === undefined) delete process.env.FLAPSTACK_ADAPTER_TEST_SECRET
      else process.env.FLAPSTACK_ADAPTER_TEST_SECRET = before
    }
  })
  it("preserves a valid failure receipt", async () => {
    expect(await validateWithArchify(fixture("failure"))).toMatchObject({
      ok: false,
      error: "Invalid diagram",
    })
  })
  it.each(["malformed", "wrong-input", "contradiction", "bad-check", "overflow"])(
    "rejects %s results",
    async (mode) => {
      await expect(validateWithArchify(fixture(mode))).rejects.toThrow()
    },
  )
  it("rejects escaped inputs and unknown diagram kinds before dispatch", async () => {
    const options = fixture()
    await expect(validateWithArchify({ ...options, inputPath: options.cliPath })).rejects.toThrow(
      "inside",
    )
    await expect(validateWithArchify({ ...options, kind: "shell" })).rejects.toThrow()
  })

  it("rejects a directory link that escapes the workspace", async () => {
    const options = fixture()
    const link = path.join(options.workspaceRoot, "linked")
    symlinkSync(
      path.dirname(options.cliPath),
      link,
      process.platform === "win32" ? "junction" : "dir",
    )
    await expect(
      validateWithArchify({
        ...options,
        inputPath: path.join(link, path.basename(options.cliPath)),
      }),
    ).rejects.toThrow("inside")
  })
  it("bounds a hanging process and awaits its exit", async () => {
    await expect(validateWithArchify({ ...fixture("hang"), timeoutMs: 100 })).rejects.toThrow(
      "timed out",
    )
  })
  it("cancels an active process and rejects an already-cancelled request", async () => {
    const controller = new AbortController()
    const options = { ...fixture("hang"), signal: controller.signal }
    const pending = validateWithArchify(options)
    controller.abort()
    await expect(pending).rejects.toThrow("cancelled")
    await expect(validateWithArchify(options)).rejects.toThrow("cancelled")
  })
})
