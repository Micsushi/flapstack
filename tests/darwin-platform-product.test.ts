import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { spawnSync } from "node:child_process"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  DarwinPlatformProvider,
  darwinCliManagementSupported,
} from "../src/main/lib/platform/darwin"

const directories: string[] = []

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  directories.push(directory)
  return directory
}

function writeAppLauncher(
  source: string,
  bundleIdentifier = "dev.flapstack.app",
  decoy = "",
): void {
  mkdirSync(dirname(source), { recursive: true })
  writeFileSync(source, "launcher")
  writeFileSync(
    join(dirname(dirname(dirname(source))), "Info.plist"),
    `<?xml version="1.0"?><plist><dict>${decoy}<key>CFBundleIdentifier</key><string>${bundleIdentifier}</string></dict></plist>`,
  )
}

class TestDarwinProvider extends DarwinPlatformProvider {
  readonly commands: string[][] = []

  constructor(private readonly installPath: string) {
    super()
  }

  override getCliConfig() {
    return { installPath: this.installPath, scriptName: "flapstack", requiresAdmin: true }
  }

  override async execCommand(command: string, args: string[]) {
    this.commands.push([command, ...args])
    return { stdout: "", stderr: "" }
  }

  protected override readBundleIdentifier(infoPlist: string): string | null {
    const plist = readFileSync(infoPlist, "utf8").replace(/<!--[\s\S]*?-->/g, "")
    return /<key>CFBundleIdentifier<\/key>\s*<string>([^<]+)<\/string>/.exec(plist)?.[1] ?? null
  }
}

afterEach(() => {
  while (directories.length > 0) rmSync(directories.pop()!, { recursive: true, force: true })
})

describe("macOS product platform behavior", () => {
  it("opens the exact app bundle that owns the packaged launcher", () => {
    const root = temporaryDirectory("flapstack-mac-cli-")
    const appBundle = join(root, "Flapstack Preview.app")
    const launcher = join(appBundle, "Contents", "Resources", "cli", "flapstack")
    const installedLauncher = join(root, "bin", "flapstack")
    const selectedDirectory = join(root, "project with spaces")
    const marker = join(root, "open-arguments.txt")
    const openStub = join(root, "stub", "open")
    mkdirSync(dirname(launcher), { recursive: true })
    mkdirSync(dirname(installedLauncher), { recursive: true })
    mkdirSync(selectedDirectory)
    mkdirSync(dirname(openStub), { recursive: true })
    writeFileSync(launcher, readFileSync(join(process.cwd(), "resources", "cli", "flapstack")))
    chmodSync(launcher, 0o755)
    symlinkSync(launcher, installedLauncher)
    writeFileSync(openStub, '#!/bin/sh\nprintf "%s\\n" "$@" > "$FLAPSTACK_OPEN_MARKER"\n')
    chmodSync(openStub, 0o755)

    const result = spawnSync("/bin/bash", [installedLauncher, selectedDirectory], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${dirname(openStub)}:${process.env.PATH ?? ""}`,
        FLAPSTACK_OPEN_MARKER: marker,
      },
    })

    expect(result.status, result.stderr || result.stdout).toBe(0)
    expect(readFileSync(marker, "utf8").trim().split("\n")).toEqual([
      appBundle,
      "--args",
      selectedDirectory,
    ])
  })

  it("passes privileged paths as arguments instead of AppleScript source", async () => {
    const root = temporaryDirectory("flapstack-mac-cli-quotes-")
    const source = join(root, 'Flapstack "quoted".app', "Contents", "Resources", "cli", "flapstack")
    const installPath = join(root, "bin", "flapstack")
    writeAppLauncher(source)
    const provider = new TestDarwinProvider(installPath)

    await expect(provider.installCli(source)).resolves.toEqual({ success: true })
    expect(provider.commands).toHaveLength(1)
    expect(provider.commands[0].slice(-4)).toEqual(["--", installPath, source, ""])
    expect(provider.commands[0][2]).not.toContain(source)
    expect(provider.commands[0][2]).not.toContain(installPath)
    if (process.platform === "darwin") {
      const compiledPath = join(root, "install.scpt")
      const compiled = spawnSync(
        "/usr/bin/osacompile",
        ["-e", provider.commands[0][2]!, "-o", compiledPath],
        { encoding: "utf8" },
      )
      expect(
        compiled.status,
        `${compiled.stderr || compiled.stdout}\n${provider.commands[0][2]}`,
      ).toBe(0)
    }

    mkdirSync(dirname(installPath), { recursive: true })
    symlinkSync(source, installPath)
    await expect(provider.uninstallCli()).resolves.toEqual({ success: true })
    expect(provider.commands[1].slice(-3)).toEqual(["--", installPath, source])
    expect(provider.commands[1][2]).not.toContain(source)
    expect(provider.commands[1][2]).not.toContain(installPath)
    if (process.platform === "darwin") {
      const compiled = spawnSync(
        "/usr/bin/osacompile",
        ["-e", provider.commands[1][2]!, "-o", join(root, "uninstall.scpt")],
        { encoding: "utf8" },
      )
      expect(
        compiled.status,
        `${compiled.stderr || compiled.stdout}\n${provider.commands[1][2]}`,
      ).toBe(0)
    }
  })

  it("never replaces or removes an unowned command", async () => {
    const root = temporaryDirectory("flapstack-mac-cli-unowned-")
    const source = join(root, "Flapstack.app", "Contents", "Resources", "cli", "flapstack")
    const installPath = join(root, "bin", "flapstack")
    mkdirSync(dirname(source), { recursive: true })
    mkdirSync(dirname(installPath), { recursive: true })
    writeFileSync(source, "launcher")
    writeFileSync(installPath, "third party")
    const provider = new TestDarwinProvider(installPath)

    await expect(provider.installCli(source)).resolves.toEqual(
      expect.objectContaining({ success: false, error: expect.stringContaining("not owned") }),
    )
    await expect(provider.uninstallCli()).resolves.toEqual(
      expect.objectContaining({ success: false, error: expect.stringContaining("not owned") }),
    )
    expect(provider.commands).toHaveLength(0)
    expect(readFileSync(installPath, "utf8")).toBe("third party")
  })

  it("never replaces or removes a foreign app-shaped symlink", async () => {
    const root = temporaryDirectory("flapstack-mac-cli-foreign-")
    const source = join(root, "Flapstack.app", "Contents", "Resources", "cli", "flapstack")
    const foreign = join(root, "Other.app", "Contents", "Resources", "cli", "flapstack")
    const installPath = join(root, "bin", "flapstack")
    writeAppLauncher(source)
    writeAppLauncher(
      foreign,
      "com.example.other",
      "<!-- <key>CFBundleIdentifier</key><string>dev.flapstack.app</string> -->",
    )
    mkdirSync(dirname(installPath), { recursive: true })
    symlinkSync(foreign, installPath)
    const provider = new TestDarwinProvider(installPath)

    await expect(provider.installCli(source)).resolves.toEqual(
      expect.objectContaining({ success: false, error: expect.stringContaining("not owned") }),
    )
    await expect(provider.uninstallCli()).resolves.toEqual(
      expect.objectContaining({ success: false, error: expect.stringContaining("not owned") }),
    )
    expect(provider.commands).toHaveLength(0)
    expect(readFileSync(installPath, "utf8")).toBe("launcher")
  })

  it("recognizes only the exact installed launcher", () => {
    const root = temporaryDirectory("flapstack-mac-cli-status-")
    const source = join(root, "Flapstack.app", "Contents", "Resources", "cli", "flapstack")
    const installPath = join(root, "bin", "flapstack")
    writeAppLauncher(source)
    mkdirSync(dirname(installPath), { recursive: true })
    symlinkSync(source, installPath)

    const provider = new TestDarwinProvider(installPath)
    expect(provider.isCliInstalled(source)).toBe(true)
    expect(provider.isCliInstalled(`${source}-other`)).toBe(false)
  })

  it("allows only packaged production to manage the production CLI", () => {
    expect(
      darwinCliManagementSupported({
        defaultApp: false,
        executablePath: "/Applications/Flapstack.app/Contents/MacOS/Flapstack",
      }),
    ).toBe(true)
    expect(
      darwinCliManagementSupported({
        defaultApp: false,
        executablePath: "/Applications/Flapstack Preview.app/Contents/MacOS/Flapstack Preview",
      }),
    ).toBe(false)
    expect(
      darwinCliManagementSupported({
        defaultApp: true,
        executablePath: "/repo/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron",
      }),
    ).toBe(false)
  })
})
