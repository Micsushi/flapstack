import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { LinuxPlatformProvider } from "../src/main/lib/platform/linux"

describe("Linux product integration", () => {
  it("installs and removes the CLI in the user-local bin without a shell", async () => {
    const root = mkdtempSync(join(tmpdir(), "flapstack-linux-cli-"))
    const source = join(root, "resources", "cli", "flapstack")
    const installPath = join(root, "home", ".local", "bin", "flapstack")
    mkdirSync(join(root, "resources", "cli"), { recursive: true })
    writeFileSync(source, "#!/bin/sh\n")
    chmodSync(source, 0o755)
    const provider = new LinuxPlatformProvider()
    provider.getCliConfig = () => ({ installPath, scriptName: "flapstack", requiresAdmin: false })

    await expect(provider.installCli(source)).resolves.toEqual({ success: true })
    expect(lstatSync(installPath).isSymbolicLink()).toBe(true)
    expect(readlinkSync(installPath)).toBe(source)
    expect(provider.isCliInstalled(source)).toBe(true)
    await expect(provider.uninstallCli()).resolves.toEqual({ success: true })
    expect(provider.isCliInstalled(source)).toBe(false)
  })

  it("bundles one launcher that handles macOS and Linux packages", () => {
    const launcher = readFileSync("resources/cli/flapstack", "utf8")
    expect(launcher).toContain("Darwin)")
    expect(launcher).toContain("Linux)")
    expect(launcher).toContain("$APP_ROOT/flapstack-preview")
    expect(launcher).toContain('exec "$EXECUTABLE" "$DIR"')
  })
})
