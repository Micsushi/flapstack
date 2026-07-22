# Windows Development and Packaging

This is the executable setup path for native Windows x64 development. WSL and
Git Bash are not required.

## Supported host

- Windows 10 or 11, x64
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
```

The release config has `forceCodeSigning: true`; missing or invalid signing
credentials fail the build. Preview remains unsigned for local and CI verification.

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
packaging, package inspection, and artifact upload.
