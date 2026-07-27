# Windows Development and Packaging

This is the executable setup path for native Windows x64 development. WSL and
Git Bash are not required.

## Supported host

- Windows 11, x64
- Node.js 22 and npm 10 (`.nvmrc`, `.node-version`, and `packageManager` define
  the repository contract)
- Python 3.11, available through `py -3.11`
- CMake 3.x on `PATH`
- Rust stable with the `x86_64-pc-windows-msvc` host
- Visual Studio 2022 Build Tools with Desktop development with C++, MSBuild 17,
  a Windows 10/11 SDK, and **MSVC v143 x64/x86 Spectre-mitigated libraries**
- Git 2.x and Windows PowerShell 5.1 or PowerShell 7+

The Spectre component is mandatory because `node-pty` enables Spectre mitigation
in its Windows native targets. Without it, MSBuild exits with `MSB8040`.

## Preflight and install

Run from native PowerShell:

```powershell
node --version
npm --version
npm run windows:prerequisites
npm ci --legacy-peer-deps
```

`preinstall` runs the same preflight automatically. It reports every missing or
unsupported prerequisite in one pass and does not modify machine software.
The same root commands are supported when the checkout path contains spaces,
Unicode, ampersands, parentheses, or percent signs. Keep using argument arrays
in new Node scripts: project package bins are launched through their JavaScript
entrypoints, and the heavy-job wrapper resolves native `.exe` and `.cmd` shims
without interpolating user arguments into an unquoted shell command.

If the native ABI marker is absent or stale, repair and prove both runtimes:

```powershell
node scripts/ensure-native-abi.mjs node
node scripts/ensure-native-abi.mjs electron
```

Rebuilds call JavaScript tool entrypoints directly; they do not rely on Unix
executables or `.cmd` shim behavior. A failed rebuild leaves the marker invalid.

## Development gates

```powershell
npm run lint
npm run style:check
npm run ts:check
npm test
npm run build
npm run dev
npm run dev:verify
```

Lint, style, test, check, and build share one heavy-job lease. A concurrent
request exits with code 75 and names the current owner; an abandoned owner is
reclaimed. Child failures keep their exit code, and Ctrl+C is forwarded to the
owned child before the lease is released.

For the native DPAPI, Electron node-pty, and per-user Scheduled Task lifecycle,
close every Flapstack instance and run the isolated Windows acceptance gate:

```powershell
node scripts/ensure-native-abi.mjs electron
$env:FLAPSTACK_RUN_WINDOWS_PLATFORM_LIVE = '1'
try {
  node scripts/run-project-bin.mjs vitest vitest -- run tests/windows-native-platform-live.test.ts
} finally {
  Remove-Item Env:FLAPSTACK_RUN_WINDOWS_PLATFORM_LIVE -ErrorAction SilentlyContinue
  node scripts/ensure-native-abi.mjs node
}
```

The gate uses disposable credentials, paths, and a uniquely named limited-user
Scheduled Task. It opens no window and verifies cleanup after graceful stop and
uninstall.

The dev launcher removes only processes proven to belong to this exact checkout,
waits for their child trees, requires port 5173 to be free, and launches the local
Electron/Vite entrypoint. `dev:verify` rejects packaged apps or another profile.

## Windows resources and Preview package

```powershell
npm run claude:download
npm run codex:download
node scripts/prepare-whisper-binary.mjs --platform=win32-x64
npm run package:preview:win
npm run package:inspect:preview:win
npm run package:smoke:preview:win
npm run package:audit:preview:win
```

Preview uses its own app ID, executable name, `flapstack-preview://` protocol,
profile, and `release-preview` output. Inspection verifies PE/x64 architecture for
the app, agent binaries, speech sidecars, better-sqlite3, and every node-pty native
output, plus the app archive, licenses, and Electron file version.

## Signed release

Keep certificate material outside the repository:

```powershell
$env:WIN_CSC_LINK = '<secure PFX path, URL, or base64 value>'
$env:WIN_CSC_KEY_PASSWORD = '<certificate password>'
npm run package:release:win
npm run package:inspect:release:win
npm run package:smoke:release:win
npm run package:audit:release:win
```

The release config has `forceCodeSigning: true`; missing or invalid signing
credentials fail the build. NSIS and portable artifacts have distinct names.
The public publisher identity is pinned in
`build/windows-release-security-policy.json`; environment variables cannot
redefine it. Before the first signed release, add the real certificate SHA-1
thumbprint and clear the explicit release block. The audit requires valid
timestamped signatures from that pinned publisher on Flapstack-owned
executables, the installer, and the portable artifact. Every bundled vendor
executable must also have a valid timestamped signature and recorded publisher
identity. DLLs and Node native modules remain hash, architecture, origin, and
signature inventory entries. The audit also requires embedded exact-source
provenance, a clean release checkout, a complete SHA-256 manifest, content-based
PE allowlisting, included dependency-license notices, a complete package secret
scan, and a fresh Microsoft Defender scan bound to the unchanged package hash.
Preview remains explicitly unsigned and records its signature state without
claiming a signed release.

The assisted uninstaller preserves user data by default. To exercise explicit
remove-data behavior, invoke the installed `Uninstall Flapstack.exe` with
`--delete-app-data`. Upgrades use electron-builder's keep-data path regardless
of that explicit user uninstall option.

## Common failures

- `Node 22 is required`: switch the active runtime before installing packages.
- `Python 3.11 is required`: select Python 3.11; Python 3.12/3.13 is unsupported.
- `CMake is required`: install CMake and reopen PowerShell so `PATH` refreshes.
- `MSB8040`: add the MSVC v143 x64/x86 Spectre-mitigated libraries in Visual
  Studio Installer, then rerun ABI repair.
- `NODE_MODULE_VERSION` mismatch: run the Node or Electron ABI repair matching
  the next command. Do not hand-edit `.native-abi`.
- Port 5173 occupied: use the printed `Get-NetTCPConnection` command, inspect the
  owning PID, and stop it only after confirming ownership.
- `dev:verify` fails: close Preview/release builds from this checkout, start
  `npm run dev`, and rerun verification.

## CI evidence

The `windows-verify` job uses `windows-2022`, Node 22, and Python 3.11. It runs
clean install, prerequisite validation, the complete check gate, Windows Preview
packaging, package inspection, package security reporting, and artifact upload.
Windows Server 2022 is accepted only as this CI build host; it is not a supported
Flapstack product runtime or a substitute for Windows 11 acceptance.
