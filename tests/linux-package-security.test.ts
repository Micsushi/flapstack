import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
// @ts-expect-error JavaScript package-audit helper intentionally has no declaration file.
import {
  assertDebPackageMetadata,
  assertEmbeddedProvenance,
  assertLinuxDesktopEntry,
  assertLinuxNativeInventory,
  assertNoEmbeddedNativePayload,
  inspectLinuxNativeFiles,
} from "../scripts/audit-linux-package.mjs"

describe("Linux package security report", () => {
  it("wires preview and release audit entrypoints for x64 and arm64", () => {
    const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts
    for (const channel of ["preview", "release"]) {
      for (const architecture of ["x64", "arm64"]) {
        const suffix = architecture === "arm64" ? ":arm64" : ""
        const command = scripts[`package:audit:${channel}:linux${suffix}`]
        expect(command).toContain("scripts/audit-linux-package.mjs")
        expect(command).toContain(`--platform=linux-${architecture}`)
        expect(command).toContain(`--channel=${channel}`)
      }
    }
  })

  it("accepts exact Preview Debian identity and runtime dependencies", () => {
    expect(() =>
      assertDebPackageMetadata(
        {
          Package: "flapstack-preview",
          Version: "0.1.0",
          Architecture: "amd64",
          Depends:
            "libasound2, libatspi2.0-0, libgbm1, libgtk-3-0, libnotify4, libnss3, libsecret-1-0, libuuid1, libxss1, libxtst6, xdg-utils",
        },
        {
          channel: "preview",
          version: "0.1.0",
          architecture: "x64",
          dependencies: ["libgtk-3-0", "libsecret-1-0", "libgbm1", "libasound2"],
        },
      ),
    ).not.toThrow()
  })

  it("rejects package collisions, wrong architectures, and missing dependencies", () => {
    const expected = {
      channel: "preview",
      version: "0.1.0",
      architecture: "arm64",
      dependencies: ["libgtk-3-0", "libsecret-1-0"],
    }
    expect(() =>
      assertDebPackageMetadata(
        {
          Package: "flapstack",
          Version: "0.1.0",
          Architecture: "arm64",
          Depends: "libgtk-3-0, libsecret-1-0",
        },
        expected,
      ),
    ).toThrow(/package identity/i)
    expect(() =>
      assertDebPackageMetadata(
        {
          Package: "flapstack-preview",
          Version: "0.1.0",
          Architecture: "amd64",
          Depends: "libgtk-3-0, libsecret-1-0",
        },
        expected,
      ),
    ).toThrow(/architecture/i)
    expect(() =>
      assertDebPackageMetadata(
        {
          Package: "flapstack-preview",
          Version: "0.1.0",
          Architecture: "arm64",
          Depends: "libgtk-3-0",
        },
        expected,
      ),
    ).toThrow(/libsecret-1-0/i)
  })

  it("requires the expected executable and protocol without disabling Chromium sandboxing", () => {
    expect(() =>
      assertLinuxDesktopEntry(
        [
          "[Desktop Entry]",
          "Name=Flapstack Preview",
          "Exec=/opt/Flapstack-Preview/flapstack-preview %U",
          "MimeType=x-scheme-handler/flapstack-preview;",
        ].join("\n"),
        { channel: "preview" },
      ),
    ).not.toThrow()
    expect(() =>
      assertLinuxDesktopEntry(
        "[Desktop Entry]\nExec=/opt/Flapstack-Preview/flapstack-preview --no-sandbox %U\nMimeType=x-scheme-handler/flapstack-preview;\n",
        { channel: "preview" },
      ),
    ).toThrow(/sandbox/i)
  })

  it("requires every Linux native payload to match the requested ELF architecture", () => {
    expect(() =>
      assertLinuxNativeInventory(
        [
          { path: "flapstack-preview", format: "elf", architectures: ["x64"] },
          { path: "resources/bin/claude", format: "elf", architectures: ["x64"] },
          {
            path: "resources/app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node",
            format: "elf",
            architectures: ["x64"],
          },
        ],
        "x64",
      ),
    ).not.toThrow()
    expect(() =>
      assertLinuxNativeInventory(
        [{ path: "resources/bin/claude", format: "elf", architectures: ["arm64"] }],
        "x64",
      ),
    ).toThrow(/Linux ELF x64/i)
    expect(() =>
      assertLinuxNativeInventory(
        [{ path: "resources/bin/claude", format: "pe", architectures: ["x64"] }],
        "x64",
      ),
    ).toThrow(/Linux ELF x64/i)
  })

  it("binds every distributable artifact to the inspected package provenance", () => {
    expect(() =>
      assertEmbeddedProvenance(Buffer.from("exact"), "exact", "Preview deb"),
    ).not.toThrow()
    expect(() =>
      assertEmbeddedProvenance(Buffer.from("other"), "exact", "Preview AppImage"),
    ).toThrow(/Preview AppImage.*provenance/i)
  })

  it("rejects malformed unpacked native modules and native payloads hidden in app.asar", () => {
    const packageRoot = mkdtempSync(join(tmpdir(), "flapstack-linux-native-audit-"))
    const relative = "resources/app.asar.unpacked/node_modules/example/example.node"
    const absolute = join(packageRoot, ...relative.split("/"))
    mkdirSync(join(absolute, ".."), { recursive: true })
    writeFileSync(absolute, "not an ELF binary")

    expect(() =>
      inspectLinuxNativeFiles(
        packageRoot,
        [{ path: relative, kind: "file", bytes: 17, sha256: "a".repeat(64) }],
        "x64",
      ),
    ).toThrow(/Linux ELF x64/i)
    expect(() =>
      assertNoEmbeddedNativePayload(
        "resources/app.asar/native.node",
        Buffer.from([0x7f, 0x45, 0x4c, 0x46, ...new Array(60).fill(0)]),
      ),
    ).toThrow(/unpacked.*inventoried/i)
  })
})
