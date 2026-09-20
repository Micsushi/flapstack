import { EventEmitter } from "node:events"
import type { ChildProcess } from "node:child_process"
import { expect, it } from "vitest"
import { afterProcessClose } from "../src/main/lib/git/closed-process"

it("does not release the caller on early abort until its child handles close", async () => {
  const child = new EventEmitter() as ChildProcess
  let reject!: (error: Error) => void
  const execution = Object.assign(
    new Promise<void>((_resolve, fail) => {
      reject = fail
    }),
    { child },
  )
  let returned = false
  const result = afterProcessClose(execution).catch((error) => {
    returned = true
    return error
  })
  reject(new Error("aborted"))
  await Promise.resolve()
  await Promise.resolve()
  expect(returned).toBe(false)
  child.emit("close", null, "SIGTERM")
  expect(await result).toMatchObject({ message: "aborted" })
  expect(returned).toBe(true)
})
