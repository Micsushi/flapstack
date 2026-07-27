import { mkdir, readFile, writeFile } from "node:fs/promises"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  attachmentRelativeStoragePath,
  attachmentRootForUserData,
} from "../src/main/lib/attachments/paths"
import { getDetachedChatCheckoutPath } from "../src/main/lib/worktree-resolver"
import { createPortableExport } from "../src/main/lib/portability/exporter"
import { readFileInsideRoot, writeFileInsideRoot } from "../src/main/lib/path-safety"
import { createTestDatabase } from "./portability-test-helpers"
// @ts-expect-error JavaScript path helper intentionally has no declaration file.
import { flapstackProfilePath } from "../scripts/lib/profile-paths.mjs"

const runLive =
  process.platform === "win32" && process.env.FLAPSTACK_RUN_WINDOWS_PLATFORM_LIVE === "1"
const roots: string[] = []

afterEach(() => {
  delete process.env.FLAPSTACK_CONFIG_DIR
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

async function realLongRoot(label: string): Promise<string> {
  let root = mkdtempSync(join(tmpdir(), `flapstack-${label}-雪 & ()-`))
  roots.push(root)
  let index = 0
  while (root.length <= 285) {
    root = join(root, `segment-${String(index).padStart(2, "0")}-long-path-雪`)
    index += 1
  }
  await mkdir(root, { recursive: true })
  return root
}

describe.runIf(runLive)("native Windows long paths", () => {
  it("uses production app-data, temp, export, worktree, and attachment helpers past MAX_PATH", async () => {
    const longRoot = await realLongRoot("owned-paths")
    expect(longRoot.length).toBeGreaterThan(260)

    const profilePath = flapstackProfilePath("Flapstack Dev long-path", {
      platform: "win32",
      env: { APPDATA: longRoot },
      home: longRoot,
    })
    await mkdir(profilePath, { recursive: true })
    await writeFile(join(profilePath, "profile-proof.txt"), "app-data-雪", "utf8")
    await expect(readFile(join(profilePath, "profile-proof.txt"), "utf8")).resolves.toBe(
      "app-data-雪",
    )

    await writeFileInsideRoot(longRoot, "temp/proof.txt", {
      data: "temp-雪",
    })
    await expect(
      readFileInsideRoot(longRoot, "temp/proof.txt").then((value) => value.toString("utf8")),
    ).resolves.toBe("temp-雪")

    process.env.FLAPSTACK_CONFIG_DIR = join(longRoot, "config")
    const worktreePath = getDetachedChatCheckoutPath("chat long path 雪")
    await mkdir(worktreePath, { recursive: true })
    await writeFileInsideRoot(worktreePath, "worktree-proof.txt", { data: "worktree-雪" })
    await expect(readFile(join(worktreePath, "worktree-proof.txt"), "utf8")).resolves.toBe(
      "worktree-雪",
    )

    const attachmentRoot = attachmentRootForUserData(profilePath)
    const attachmentRelativePath = attachmentRelativeStoragePath(
      "attachment-long-path",
      "proof-雪.txt",
    )
    await mkdir(attachmentRoot, { recursive: true })
    await writeFileInsideRoot(attachmentRoot, attachmentRelativePath, {
      data: "attachment-雪",
    })
    await expect(
      readFileInsideRoot(attachmentRoot, attachmentRelativePath).then((value) =>
        value.toString("utf8"),
      ),
    ).resolves.toBe("attachment-雪")

    const databaseRoot = mkdtempSync(join(tmpdir(), "flapstack-long-export-db-"))
    roots.push(databaseRoot)
    const databasePath = join(databaseRoot, "source.db")
    createTestDatabase(databasePath)
    const exportPath = join(longRoot, "stage5-long-path.flapstack-export")
    const exported = await createPortableExport({
      outputPath: exportPath,
      databasePath,
      appVersion: "stage5-live",
      selection: [{ id: "settings" }],
    })
    expect(exported.outputPath).toBe(exportPath)
    await expect(readFile(join(exportPath, "manifest.json"), "utf8")).resolves.toContain(
      "flapstack-portable",
    )
  })
})
