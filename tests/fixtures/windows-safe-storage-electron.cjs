const { app, safeStorage } = require("electron")
const { readFileSync } = require("node:fs")

const input = readFileSync(0, "utf8")

async function main() {
  try {
    await app.whenReady()
    const request = JSON.parse(input)
    if (request.action === "inspect") {
      const available = safeStorage.isEncryptionAvailable()
      process.stdout.write(
        `${JSON.stringify({
          ok: true,
          available,
          backend: safeStorage.getSelectedStorageBackend?.() ?? "dpapi",
        })}\n`,
      )
    } else if (request.action === "encrypt") {
      const ciphertext = safeStorage.encryptString(request.value)
      process.stdout.write(
        `${JSON.stringify({ ok: true, ciphertext: ciphertext.toString("base64") })}\n`,
      )
    } else if (request.action === "decrypt") {
      const value = safeStorage.decryptString(Buffer.from(request.ciphertext, "base64"))
      process.stdout.write(`${JSON.stringify({ ok: true, value })}\n`)
    } else {
      throw new Error("unsupported action")
    }
    app.quit()
  } catch (error) {
    process.stdout.write(
      `${JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      })}\n`,
    )
    app.exit(1)
  }
}

main()
