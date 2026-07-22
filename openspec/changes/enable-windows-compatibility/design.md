## Context

Windows support crosses repository tooling, native ABI management, Electron
runtime behavior, OS integrations, provider binaries, speech sidecars, and
installer lifecycle. Fixing only package generation would preserve broken
development and runtime paths. Stage 5 therefore treats Windows compatibility
as one native end-to-end product slice.

## Goals

- One documented native PowerShell path from clean clone through installed app.
- Platform-neutral repository commands with identical failure semantics.
- Deterministic Node/Electron native module setup and recovery.
- Real Windows CI plus clean-VM Dev/package evidence.
- Truthful support for Windows paths, terminals, credentials, tasks, agents,
  speech, protocols, packaging, upgrade, rollback, and uninstall.
- Signing-ready artifacts without storing or exposing production credentials.

## Non-goals

- WSL as supported runtime.
- Windows on ARM, Microsoft Store/MSIX, hosted sync, telemetry, or auto-update.
- Cross-compilation as native acceptance evidence.
- Product-polish, mobile, visual context, organization usage, or swarm features
  now owned by Stage 6.

## Decisions

1. Node scripts own cross-platform orchestration. npm scripts remain thin entrypoints.
2. Child processes use explicit executable resolution, argument arrays, and
   platform-aware shim handling; shell-string composition is rejected.
3. Node 22 and Python 3.11 are acceptance versions. Unsupported versions fail
   early with repair guidance.
4. Windows CI uses clean hosted runner coverage; native package/manual gates use
   persistent clean Windows VMs where credentials, audio, UAC, or restart matter.
5. Process cleanup targets only Flapstack-owned PIDs/process trees recorded by
   launch state. Broad Node/terminal/provider process killing is forbidden.
6. DPAPI remains Windows secret authority. Plaintext or POSIX shell fallback is forbidden.
7. Preview and production use separate identity, protocol, output, and user-data paths.
8. Production Authenticode credentials remain external. Missing credentials
   produce an explicit unsigned Preview path, never a fake signed result.
9. Every support claim maps to native observation on one exact SHA.

## Dependency flow

Toolchain -> scripts -> native install -> CI/dev lifecycle -> OS integrations,
agents, and voice -> packaging/security -> integrated acceptance.

## Failure and rollback

- Partial installs/downloads remain retryable and never write success markers.
- ABI markers are written only after real Node/Electron load probes pass.
- Package upgrade backs up/migrates state and exposes tested rollback steps.
- Uninstall removes only owned binaries, tasks, protocols, and user-selected data.
- Shared script changes must retain macOS behavior before merge.
