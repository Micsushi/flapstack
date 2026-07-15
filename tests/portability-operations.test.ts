import { describe, expect, it, vi } from "vitest"
import {
  beginExclusivePortabilityOperation,
  beginPortabilityReader,
  getPortabilityOperationState,
} from "../src/main/lib/portability/operations"

describe("portability operation coordinator", () => {
  it.each(["export", "dry-run plan"])(
    "waits for an active %s reader and blocks a late database open",
    async () => {
      const releaseReader = beginPortabilityReader()
      let exclusiveAcquired = false
      const exclusive = beginExclusivePortabilityOperation().then((release) => {
        exclusiveAcquired = true
        return release
      })
      await Promise.resolve()
      expect(getPortabilityOperationState()).toMatchObject({
        activeReaders: 1,
        exclusivePending: true,
      })
      expect(() => beginPortabilityReader()).toThrow(/maintenance is active/i)
      expect(exclusiveAcquired).toBe(false)
      releaseReader()
      const releaseExclusive = await exclusive
      expect(exclusiveAcquired).toBe(true)
      releaseExclusive()
      expect(getPortabilityOperationState()).toEqual({
        activeReaders: 0,
        exclusivePending: false,
        exclusiveActive: false,
      })
    },
  )

  it("releases exclusive ownership after a resume failure", async () => {
    const releaseExclusive = await beginExclusivePortabilityOperation()
    const resume = vi.fn(() => {
      throw new Error("resume failed")
    })
    try {
      expect(resume).toThrow("resume failed")
    } finally {
      releaseExclusive()
    }
    const releaseReader = beginPortabilityReader()
    releaseReader()
  })
})
