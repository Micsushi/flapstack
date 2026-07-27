# S5 - Native Windows Compatibility

Stage 5 turns accepted Stage 4 Flapstack into a first-class Windows 11 x64
development and packaged application. Native PowerShell workflows require no
WSL, Git Bash, manual source patches, or undocumented global configuration.

Delivery order:

1. [S5-F1 Supported Windows toolchain](features/s5-f1-supported-toolchain/README.md)
2. [S5-F2 Portable build scripts](features/s5-f2-portable-build-scripts/README.md)
3. [S5-F3 Native dependency install](features/s5-f3-native-dependency-install/README.md)
4. [S5-F4 Windows CI and dev lifecycle](features/s5-f4-windows-ci-dev-lifecycle/README.md)
5. [S5-F5 Windows OS integration](features/s5-f5-windows-os-integration/README.md)
6. [S5-F6 Agent harness parity](features/s5-f6-agent-harness-parity/README.md)
7. [S5-F7 Speech and voice parity](features/s5-f7-speech-voice-parity/README.md)
8. [S5-F8 Windows packaging and security](features/s5-f8-windows-packaging-security/README.md)
9. [S5-F9 Integrated Windows release](features/s5-f9-integrated-windows-release/README.md)

Completion model: `docs/completion-tiers.md`. A task checkbox closes at Tier 2
AI acceptance of its `T2-core` scope, including native app/MCP interaction.
Optional provider/device/environment capabilities and distributable-release
certification remain separate matrix rows. Owner testing is tracked separately
in `docs/owner-manual-testing-backlog.md`.

Entry gate: Stage 4 implementation-complete on one exact SHA. Tier 2
implementation exit requires every `T2-core` task scope and every `T2-core` row
in `docs/stage5-full-feature-test-matrix.md` against one native Windows
candidate. The 76-task board remains the complete work ledger, not 76 core
implementation blockers. It contains 37 core-only tasks, 13 mixed tasks whose
checkbox closes on their core portion, 14 capability-only tasks, one
capability-plus-release task, 10 release-only tasks, and one tracking-only task.
Thus 50 task checkboxes gate implementation. Clean install, upgrade, rollback,
uninstall, signing, approved malware scanning, and hosted-CI retention are
separate release gates. Tier 3 owner checks do not block this exit unless
explicitly labeled `release-blocking`.

Authoritative task board:
`openspec/changes/enable-windows-compatibility/tasks.md`.

Former Stage 5 product-polish scope moved to
`openspec/stages/s6-product-polish-personalization-reach/README.md`.
