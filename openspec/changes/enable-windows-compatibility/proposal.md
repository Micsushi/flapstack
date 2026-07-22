# Change: Enable first-class Windows compatibility

## Why

Flapstack contains Windows adapters and package configuration, but native
Windows development and release paths are not yet reliable. Clean install and
root verification commands depend on Unix command forms, native rebuilds do not
resolve Windows shims correctly, toolchain requirements are incomplete, and
Windows CI/runtime/package evidence is missing.

## What changes

- Pin and diagnose supported Windows toolchain versions.
- Replace POSIX-only npm/build/check/process patterns with platform-neutral Node entrypoints.
- Make native dependency install and Node/Electron ABI repair deterministic.
- Add Windows CI, exact-checkout development verification, and owned-process cleanup.
- Prove Windows paths, terminals, DPAPI, scheduled tasks, protocols, and lifecycle.
- Prove Claude/Codex binaries, authentication, runs, permissions, and recovery.
- Prove Windows STT/TTS dependencies, credentials, devices, fallbacks, and cleanup.
- Build and inspect native Preview, NSIS, and portable artifacts with signing-ready security gates.
- Close one exact-SHA integrated Windows matrix and user walkthrough.

## Impact

- Affected specs: new `windows-compatibility` capability.
- Affected areas: package scripts, native rebuild/download tools, CI, Electron
  main process, terminal/process ownership, credentials, scheduler, voice,
  packaging/signing, tests, and operator documentation.
- Roadmap: former Stage 5 scope is renumbered to Stage 6 without feature loss.
