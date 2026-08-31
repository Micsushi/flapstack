# Linux releases

Flapstack produces an AppImage and a Debian package for each explicit Linux
architecture. The Debian package is the integrated install for supported
Debian-family desktops. It installs the app, desktop entry, protocol handler,
icons, and the Ubuntu 24.04 Electron AppArmor profile. The AppImage is the
portable choice for other distributions and does not install desktop
integration by itself.

RPM is not currently a release target. AppImage covers portable launch while
the native support and lifecycle matrix is centered on Ubuntu and Debian.
Fedora, RHEL, Arch, and their derivatives remain unclaimed until they pass a
native package, desktop, service, keyring, display, and uninstall matrix.

## Support matrix

- Ubuntu 24.04 x64: development, Debian package, AppImage, GNOME X11, native
  Wayland launch, bundled runtimes, SQLite, Sharp, PTY, Secret Service, and the
  systemd user service have native evidence.
- Debian 12 x64: the Debian package has a clean container X11 launch smoke. A
  container smoke proves package dependencies and runtime startup, not a full
  desktop or hardware certification.
- Linux arm64: package, inspection, and bundled-runtime smoke pass in AArch64
  userspace under QEMU. Native arm64 hardware remains uncertified.
- Wayland screen capture: the app launches natively on Wayland. Screen capture
  also requires a working XDG Desktop Portal and PipeWire session plus an
  interactive user grant. Headless launch evidence does not certify capture.
- Microphone and audio hardware behavior remain device-specific manual checks.

## Build and inspect

Use Node 22 on the matching native architecture. Preview builds use a separate
app name, protocol, output folder, install path, and data profile. The Debian
package uses `/opt/Flapstack-Preview` so Electron's setuid sandbox can launch on
hosts that reject spaces in its re-exec path; the visible app name remains
**Flapstack Preview**.

```bash
npm ci
npm run check -- --portable-linux
npm run package:preview:linux:artifacts
npm run package:inspect:preview:linux
npm run package:smoke:preview:linux
npm run package:audit:preview:linux
```

Replace the last four commands with their `:arm64` variants on a native arm64
host. The smoke loads Claude, Codex, whisper.cpp, the speech sidecar,
better-sqlite3, Sharp, and node-pty from the packaged app.

## Install and remove

Install the Debian package with the operating system package manager so all
runtime dependencies are resolved:

```bash
sudo apt install ./flapstack-preview_0.1.0_amd64.deb
flapstack-preview
sudo apt remove flapstack-preview
```

The package declares Electron's GPU and audio runtime libraries in addition to
electron-builder's desktop dependencies. Preview and production packages use
different package, executable, desktop, protocol, and profile identities.

AppImage uses electron-builder's static runtime, so it does not require the
legacy FUSE 2 userspace library. Direct mounting still requires kernel FUSE
access. Where FUSE mounts are unavailable, use the standard extract-and-run
mode:

```bash
./Flapstack-Preview-0.1.0.AppImage --appimage-extract-and-run
```

On hosts that disable unprivileged user namespaces, the portable runtime may
fall back to launching Electron without its Chromium sandbox. Use the Debian
package for Ubuntu's AppArmor-backed sandbox integration.

## Desktop services and credentials

The in-app CLI installer creates `~/.local/bin/flapstack` without administrator
rights. It refuses to replace a command it does not own. Preview builds cannot
install or remove the production command.

Background usage tracking uses a per-user systemd service. It requires a user
systemd session. Shared usage credentials require `secret-tool` and an unlocked
Secret Service keyring. Flapstack reports the missing dependency instead of
claiming insecure storage as a secure fallback.

## Release gate

Production packaging accepts only a clean exact-source checkout:

```bash
npm run package:release:linux
npm run package:inspect:release:linux
npm run package:smoke:release:linux
npm run package:audit:release:linux
sha256sum release/Flapstack-*.AppImage release/Flapstack-*.deb
```

The audit verifies exact-source provenance, dependency license notices, secret
scan coverage, ELF architecture, Debian package identity and dependencies,
desktop and protocol registration, AppImage identity, and artifact hashes. It
writes a JSON report and adjacent SHA256 marker in the package output folder.

Before publication, repeat install, launch, upgrade, service, keyring, protocol,
CLI, restart, and uninstall checks on clean supported hosts. Record the exact
source commit and artifact checksums. Do not infer native arm64 hardware
behavior, Wayland capture, or an untested distribution from x64 Ubuntu evidence.
