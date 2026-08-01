import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import {
  getJsonAtomicPersistenceCapability,
  writeJsonRecoveryAtomic,
} from "../src/main/lib/portability/io"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("portable recovery JSON persistence", () => {
  it("reports Windows process-crash safety without claiming power-loss durability", async () => {
    const capability = getJsonAtomicPersistenceCapability()
    expect(capability.processCrashSafe).toBe(true)
    if (process.platform === "win32") {
      expect(capability.powerLossSafe).toBe(false)
      expect(capability.powerLossLimitation).toMatch(/directory/i)
    }

    const root = await mkdtemp(join(tmpdir(), "flapstack-portability-durability-"))
    roots.push(root)
    const target = join(root, "journal.json")
    await writeJsonRecoveryAtomic(target, { phase: "backup-created" })
    expect(JSON.parse(await readFile(target, "utf8"))).toEqual({ phase: "backup-created" })

    if (!capability.powerLossSafe) {
      await expect(
        writeJsonRecoveryAtomic(target, { phase: "files-publishing" }, "power-loss"),
      ).rejects.toThrow(/power-loss durability is unavailable/i)
      expect(JSON.parse(await readFile(target, "utf8"))).toEqual({ phase: "backup-created" })
    }
  })
})
