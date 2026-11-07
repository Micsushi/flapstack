import { createHash } from "node:crypto"
import { createReadStream, createWriteStream } from "node:fs"
import { copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const model = JSON.parse(await readFile(path.join(root, "src/shared/parakeet-model.json"), "utf8"))

export async function verifySpeechModel(file, expected = model) {
  try {
    if ((await stat(file)).size !== expected.sizeBytes) return false
    const hash = createHash("sha256")
    for await (const chunk of createReadStream(file)) hash.update(chunk)
    return hash.digest("hex") === expected.sha256
  } catch (error) {
    if (error.code === "ENOENT") return false
    throw error
  }
}

export async function prepareSpeechModel() {
  const directory = path.join(root, "build/generated/speech-models")
  await mkdir(directory, { recursive: true })
  const destination = path.join(directory, model.file)
  if (!(await verifySpeechModel(destination))) {
    const temporary = `${destination}.download`
    try {
      const cached = process.env.FLAPSTACK_PARAKEET_MODEL_CACHE
      if (cached && (await verifySpeechModel(cached))) {
        await copyFile(cached, temporary)
      } else {
        console.log(`Downloading bundled dictation model: ${model.label}`)
        const response = await fetch(model.url)
        if (!response.ok || !response.body)
          throw new Error(`Model download failed: ${response.status}`)
        await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary))
      }
      if (!(await verifySpeechModel(temporary)))
        throw new Error("Bundled dictation model checksum mismatch")
      await rm(destination, { force: true })
      await rename(temporary, destination)
    } finally {
      await rm(temporary, { force: true })
    }
  }
  await copyFile(
    path.join(root, "resources/licenses/nvidia-open-model-license.pdf"),
    path.join(directory, "NVIDIA-Open-Model-License.pdf"),
  )
  await writeFile(
    path.join(directory, "Notice.txt"),
    [
      "Licensed by NVIDIA Corporation under the NVIDIA Open Model License",
      `Model: ${model.label}`,
      `Source: ${model.source}`,
      `GGUF conversion: ${model.url.split("/resolve/")[0]}`,
      `License: ${model.licenseUrl}`,
      "",
    ].join("\n"),
  )
  console.log("Bundled dictation model verified")
}
