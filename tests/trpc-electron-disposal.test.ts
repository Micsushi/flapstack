import { readFileSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"
import { runInNewContext } from "node:vm"
import { initTRPC } from "@trpc/server"
import { expect, it, vi } from "vitest"
// @ts-expect-error Build-script helper has no declaration file.
import { patchTrpcElectron } from "../scripts/patch-trpc-electron.mjs"

const require = createRequire(import.meta.url)
const packageFile = require.resolve("trpc-electron/main")
const original = readFileSync(packageFile, "utf8")

it("patches both installed entrypoints idempotently and rejects unknown implementations", () => {
  for (const name of ["main.cjs", "main.mjs"]) {
    const patched = patchTrpcElectron(readFileSync(join(dirname(packageFile), name), "utf8"))
    expect(patchTrpcElectron(patched)).toBe(patched)
    expect(patched).not.toContain('throw new Error("Symbol.asyncDispose already exists")')
  }
  expect(() => patchTrpcElectron("unexpected upstream implementation")).toThrow(/Unexpected/)
})

it.each([false, true])(
  "delivers IPC subscription data and disposes once (cancel=%s)",
  async (cancel) => {
    let listener!: (event: unknown, message: unknown) => void
    const module = { exports: {} as { createIPCHandler: (input: unknown) => unknown } }
    runInNewContext(patchTrpcElectron(original), {
      module,
      exports: module.exports,
      require: (name: string) =>
        name === "electron"
          ? {
              ipcMain: { on: (_channel: string, handler: typeof listener) => (listener = handler) },
            }
          : require(name),
      Symbol,
      AbortController,
      setTimeout,
      clearTimeout,
      console,
    })
    const disposed = vi.fn()
    const finalized = vi.fn()
    const t = initTRPC.create()
    module.exports.createIPCHandler({
      router: t.router({
        review: t.procedure.subscription(({ signal }) => {
          const iterator = (async function* () {
            try {
              yield { kind: "text", rows: ["bounded fixture"] }
              if (cancel)
                await new Promise<void>((resolve) =>
                  signal?.addEventListener("abort", () => resolve(), { once: true }),
                )
            } finally {
              finalized()
            }
          })()
          // Electron's native async generators inherit this resource protocol.
          Object.setPrototypeOf(
            iterator,
            Object.create(Object.getPrototypeOf(iterator), {
              [Symbol.asyncDispose]: {
                value: async () => {
                  disposed()
                  await iterator.return(undefined)
                },
              },
            }),
          )
          return iterator
        }),
      }),
    })
    const reply = vi.fn()
    const event = {
      sender: { id: 1, isDestroyed: () => false },
      senderFrame: { routingId: 1 },
      reply,
    }
    listener(event, {
      method: "request",
      operation: { id: 1, type: "subscription", path: "review" },
    })
    await vi.waitFor(() =>
      expect(reply.mock.calls.some(([, value]) => value.result?.type === "data")).toBe(true),
    )
    if (cancel) listener(event, { method: "subscription.stop", id: 1 })
    await vi.waitFor(() => expect(disposed).toHaveBeenCalledOnce())
    expect(finalized).toHaveBeenCalledOnce()
    expect(reply.mock.calls.some(([, value]) => value.error)).toBe(false)
  },
)
