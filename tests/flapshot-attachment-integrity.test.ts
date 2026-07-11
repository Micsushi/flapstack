import { createHash } from "node:crypto"
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { flapshotAuthorizedFileReferenceSchema } from "../src/main/lib/flapshot/contracts"
import {
  validateFlapshotFileReference,
  copyVerifiedFlapshotFile,
  verifyStoredFlapshotFile,
} from "../src/main/lib/flapshot/integrity"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function pngFixture() {
  const root = await mkdtemp(join(tmpdir(), "flapstack-flapshot-"))
  roots.push(root)
  const filePath = join(root, "capture.png")
  const bytes = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.from("fixture")])
  await writeFile(filePath, bytes)
  const sha256 = createHash("sha256").update(bytes).digest("hex")
  return { filePath, bytes, sha256 }
}

describe("Flapshot attachment integrity", () => {
  it("validates canonical path, MIME signature, size, hash, and artifact ID", async () => {
    const fixture = await pngFixture()
    const reference = flapshotAuthorizedFileReferenceSchema.parse({
      kind: "managed-artifact",
      artifactId: "capture-1",
      mimeType: "image/png",
      sizeBytes: fixture.bytes.length,
      sha256: fixture.sha256,
      local: { path: fixture.filePath, grantedToClientId: "flapstack-test" },
    })
    const canonicalPath = await realpath(fixture.filePath)

    await expect(validateFlapshotFileReference(reference, "flapstack-test")).resolves.toMatchObject(
      {
        canonicalPath,
        sourceArtifactId: "capture-1",
        copyIntoFlapstack: true,
      },
    )
  })

  it("detects tampered and missing files after ingestion", async () => {
    const fixture = await pngFixture()
    const canonicalPath = await realpath(fixture.filePath)
    const metadata = {
      filePath: canonicalPath,
      sizeBytes: fixture.bytes.length,
      sha256: fixture.sha256,
      mimeType: "image/png",
    }
    await expect(verifyStoredFlapshotFile(metadata)).resolves.toMatchObject({ status: "verified" })
    await writeFile(fixture.filePath, Buffer.concat([fixture.bytes, Buffer.from("changed")]))
    await expect(verifyStoredFlapshotFile(metadata)).resolves.toMatchObject({ status: "tampered" })
    await rm(fixture.filePath)
    await expect(verifyStoredFlapshotFile(metadata)).resolves.toMatchObject({ status: "missing" })
  })

  it("rejects an invalid managed artifact ID before file access", () => {
    expect(() =>
      flapshotAuthorizedFileReferenceSchema.parse({
        kind: "managed-artifact",
        artifactId: "../escape",
        mimeType: "image/png",
        sizeBytes: 1,
        sha256: "a".repeat(64),
        local: { path: "/tmp/capture.png", grantedToClientId: "client" },
      }),
    ).toThrow()
  })

  it("rejects a local grant for a different authenticated client", async () => {
    const fixture = await pngFixture()
    const reference = flapshotAuthorizedFileReferenceSchema.parse({
      kind: "managed-artifact",
      artifactId: "capture-2",
      mimeType: "image/png",
      sizeBytes: fixture.bytes.length,
      sha256: fixture.sha256,
      local: { path: fixture.filePath, grantedToClientId: "other-client" },
    })
    await expect(validateFlapshotFileReference(reference, "expected-client")).rejects.toThrow(
      "another authenticated client",
    )
  })

  it("rejects an expired external grant at use time", async () => {
    const fixture = await pngFixture()
    await expect(
      verifyStoredFlapshotFile({
        filePath: fixture.filePath,
        sizeBytes: fixture.bytes.length,
        sha256: fixture.sha256,
        mimeType: "image/png",
        grantExpiresAt: "2000-01-01T00:00:00.000Z",
      }),
    ).resolves.toMatchObject({ status: "tampered", message: expect.stringContaining("expired") })
  })

  it("copies through a verified temporary file before atomic publication", async () => {
    const fixture = await pngFixture()
    const sourcePath = await realpath(fixture.filePath)
    const destination = join(dirname(sourcePath), "published.png")
    await expect(
      copyVerifiedFlapshotFile({
        sourcePath,
        destinationPath: destination,
        overwrite: false,
        sizeBytes: fixture.bytes.length,
        sha256: fixture.sha256,
        mimeType: "image/png",
      }),
    ).resolves.toMatchObject({ status: "verified" })
    await expect(readFile(destination)).resolves.toEqual(fixture.bytes)
  })
})
