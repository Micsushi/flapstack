import { X509Certificate, createPrivateKey, createPublicKey, randomUUID } from "node:crypto"
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { join } from "node:path"
import { generate } from "selfsigned"
import { defaultMobileBridgeDataDir } from "./settings"
import type { MobileBridgeCertificate, MobileBridgeCertificateProvider } from "./types"

const CERTIFICATE_FILE = "certificate.pem"
const PRIVATE_KEY_FILE = "private-key.pem"
const CERTIFICATE_LIFETIME_MS = 365 * 24 * 60 * 60_000
const RENEW_BEFORE_MS = 7 * 24 * 60 * 60_000

export class FileMobileBridgeCertificateProvider implements MobileBridgeCertificateProvider {
  constructor(
    private readonly directory = join(defaultMobileBridgeDataDir(), "mobile-bridge-tls"),
    private readonly now = Date.now,
  ) {}

  async getOrCreate(address: string): Promise<MobileBridgeCertificate> {
    const current = this.readProtected()
    if (
      current &&
      current.notAfter - this.now() > RENEW_BEFORE_MS &&
      certificateCovers(current, address)
    )
      return current

    const notBeforeDate = new Date(this.now() - 60_000)
    const notAfterDate = new Date(this.now() + CERTIFICATE_LIFETIME_MS)
    const generated = await generate([{ name: "commonName", value: "Flapstack Mobile Bridge" }], {
      keyType: "ec",
      curve: "P-256",
      algorithm: "sha256",
      notBeforeDate,
      notAfterDate,
      extensions: [
        { name: "basicConstraints", cA: false, critical: true },
        { name: "keyUsage", digitalSignature: true, keyAgreement: true, critical: true },
        { name: "extKeyUsage", serverAuth: true },
        { name: "subjectAltName", altNames: [{ type: 7, ip: address }] },
      ],
    })
    this.writeProtected(CERTIFICATE_FILE, generated.cert, 0o600)
    this.writeProtected(PRIVATE_KEY_FILE, generated.private, 0o600)
    return parseCertificate(generated.cert, generated.private)
  }

  private readProtected(): MobileBridgeCertificate | null {
    const certPath = join(this.directory, CERTIFICATE_FILE)
    const keyPath = join(this.directory, PRIVATE_KEY_FILE)
    if (!existsSync(certPath) || !existsSync(keyPath)) return null
    if ((statSync(keyPath).mode & 0o077) !== 0) {
      throw new Error("Mobile bridge private key permissions are not owner-only.")
    }
    try {
      return parseCertificate(readFileSync(certPath, "utf8"), readFileSync(keyPath, "utf8"))
    } catch {
      return null
    }
  }

  private writeProtected(name: string, value: string, mode: number): void {
    mkdirSync(this.directory, { recursive: true, mode: 0o700 })
    chmodSync(this.directory, 0o700)
    const target = join(this.directory, name)
    const temp = `${target}.${randomUUID()}.tmp`
    let fd: number | null = null
    try {
      fd = openSync(temp, "wx", mode)
      writeFileSync(fd, value, "utf8")
      fsyncSync(fd)
      closeSync(fd)
      fd = null
      renameSync(temp, target)
      chmodSync(target, mode)
    } finally {
      if (fd !== null) closeSync(fd)
      rmSync(temp, { force: true })
    }
  }
}

function parseCertificate(certPem: string, privateKeyPem: string): MobileBridgeCertificate {
  const certificate = new X509Certificate(certPem)
  const certificatePublicKey = certificate.publicKey.export({ type: "spki", format: "der" })
  const privateKeyPublicKey = createPublicKey(createPrivateKey(privateKeyPem)).export({
    type: "spki",
    format: "der",
  })
  if (!certificatePublicKey.equals(privateKeyPublicKey)) {
    throw new Error("Mobile bridge certificate and private key do not match.")
  }
  return {
    certPem,
    privateKeyPem,
    fingerprint: `sha256:${certificate.fingerprint256.replaceAll(":", "").toLowerCase()}`,
    notBefore: Date.parse(certificate.validFrom),
    notAfter: Date.parse(certificate.validTo),
  }
}

function certificateCovers(certificate: MobileBridgeCertificate, address: string): boolean {
  try {
    return new X509Certificate(certificate.certPem).checkIP(address) === address
  } catch {
    return false
  }
}
