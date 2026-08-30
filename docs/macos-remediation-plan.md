# macOS remediation plan

This plan converts every Conditional, Not certified, and Not ready row in
[macOS feature readiness](macos-feature-readiness.md) into an evidence-backed
macOS completion path.

The existing OpenSpec changes remain the only implementation task boards. This
document is a cross-feature execution router and contains no duplicate task
checkboxes.

## Outcome

Flapstack is complete for macOS when all 59 feature groups are either Ready or
N/A, with zero Conditional, Not certified, or Not ready rows. Completion means:

- one immutable source revision passes the full repository gate;
- Apple Silicon and Intel packages pass inspection and clean lifecycle tests;
- the promoted public package is signed, notarized, stapled, and accepted by
  Gatekeeper;
- real macOS UI, accessibility, voice, capture, multi-window, sleep/wake, and
  long-run checks pass;
- every advertised provider, local service, mobile flow, private remote,
  organization API, and Obsidian integration has live evidence;
- the owner completes the exact-candidate integrated walkthrough.

The intentionally unsigned `0.1.0` beta may continue as a separate Preview
channel. It cannot satisfy the stable public-distribution requirement.

## Non-goals

- Do not port Windows-only Stage 5 behavior such as DPAPI, PowerShell, NSIS,
  Authenticode, or Task Scheduler to macOS.
- Do not fake provider, device, signing, accessibility, or long-run evidence
  with fixtures.
- Do not store credentials, signing material, tokens, private remotes, or owner
  test data in Git.
- Do not expand the supported Obsidian subset, local-model contract, or provider
  list while closing macOS evidence.

## Required owner inputs

These do not block code-only work, but they block final completion:

| Input                                                                | Needed for                                     | Recommended default                                                                                                |
| -------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Apple Developer ID Application identity and notarization credentials | S6-F10 stable distribution                     | Use CI-scoped secrets and a documented local recovery path. Keep Preview unsigned.                                 |
| Disposable Claude, broader Cursor, and organization Admin access     | Remaining provider and usage live matrices     | Use low-limit test accounts with no production data. Resolve the current Claude spend-limit block before its lane. |
| iOS Safari and Android-class Chromium devices on a private LAN       | S6-F4                                          | Use one current device from each browser class. Do not use a public relay.                                         |
| Intel Mac or declared native hosted Intel runner                     | S6-F10                                         | Keep both `arm64` and `x64` as supported release architectures.                                                    |
| Dedicated uninterrupted lifecycle and owner-review window            | S6-F1, S6-F5, S6-F6, S6-F9, S6-F11, and S6-F12 | Reserve time for display/permission changes, sleep/wake, the 24-hour soak, and final owner signoff.                |

Visible-UI permission, an Apple Silicon Mac, Obsidian, OpenRouter and NanoGPT
credentials, and a user-owned private Git remote were supplied during this
pass. They no longer block their completed basic live lanes. The private proof
remote remains private and intentionally undeleted.

## Execution order

```text
MAC-P0 Evidence freeze
  -> MAC-P1 Native automation gaps
     -> MAC-P2 UI and onboarding
     -> MAC-P3 Hardware and lifecycle
     -> MAC-P4 Providers and external services
        -> MAC-P5 Signed dual-architecture package
           -> MAC-P6 Integrated release decision
```

MAC-P2, MAC-P3, and MAC-P4 may run independently after MAC-P1. MAC-P5 can set
up signing and CI earlier, but it cannot freeze the final candidate until the
three capability phases pass.

## MAC-P0: Freeze the evidence contract

**Outcome:** every current macOS gap has one owner, one exact verification path,
and one authoritative matrix row.

**Scope:** S2-A/B/D/E/T; S3-F5/F9/F11/F14/F15/F16/F17; S4-F3/F6/F7/F8/F11;
S5-F6/F7; S6-F1/F2/F4/F5/F6/F7/F8/F9/F10/F11/F12.

**Work:**

1. Reconcile [macOS feature readiness](macos-feature-readiness.md), Stage 3-6
   matrices, the candidate ledger, and the existing OpenSpec tasks.
2. Label each remaining row as code, capability, release, or owner evidence.
3. Record exact machine, architecture, OS, Node, app version, profile, provider,
   artifact hash, signing state, and source revision requirements.
4. Keep Windows-only Stage 5 rows N/A and map only their shared macOS regression
   obligations.

**Acceptance:** no gap is unowned, no evidence can be reused across a different
revision, and no duplicate task board exists.

**Blocked by:** none. **Blocks:** MAC-P1 through MAC-P6.

## MAC-P1: Close native automation and harness gaps

**Outcome:** every macOS behavior that can be proven without external accounts,
devices, or signing authority has a deterministic local gate.

**Current state:** the working tree now implements native macOS process
inspection and cleanup. Real cold-start, 200-message render, 200-message search,
and four-pane probes pass. The full local gate, all 46 minimum-supported
performance budgets, Apple Silicon Preview, Intel cross-package inspection,
and Rosetta native-module smoke pass. A single local command now collects
sanitized evidence for both architectures, and the package security auditor
checks file hashes, credentials, licenses, native inventory, provenance,
signature state, and entitlements, including explicit linker ad-hoc beta state.
An isolated temporary-directory harness now passes install, upgrade, rollback,
reinstall, LaunchAgent cleanup, uninstall, and profile preservation without
touching `/Applications`. Native Intel provider smoke, hosted exact-candidate
CI, signed distribution, and owner-only lifecycle checks remain.

**Work packages:**

1. Implement macOS exact-process Electron startup, ownership verification,
   descendant discovery, timeout cleanup, and supervisor behavior for S6-F9.
   Replace Windows-only process queries with a platform adapter while retaining
   the same run-token, executable, creation-time, checkout, and profile checks.
2. Add macOS coverage for abnormal exit, child reparenting, hung renderer,
   descriptor spoofing, stale profile, and owned-tree cleanup. Never kill an
   unrelated Electron or Flapstack process.
3. Extend package smoke to open an isolated Preview profile, verify main,
   renderer, database, native modules, bundled provider CLIs, usage daemon, and
   clean shutdown without visible UI control.
4. Add one command that collects sanitized candidate identity and all macOS
   readiness evidence without credentials.
5. Run `npm run check`, native ABI checks, deterministic performance budgets,
   `npm run dev:verify`, Apple Silicon package inspection, and daemon smoke.

**Authority:**
[harden-product-performance](../openspec/changes/harden-product-performance/tasks.md),
[integrated Stage 3 release](stage3-full-feature-test-matrix.md), and
[Stage 6 performance rows](stage6-full-feature-test-matrix.md).

**Acceptance:** the exact-process performance harness runs on macOS, cleans only
its owned tree, produces complete provenance, and fails closed on spoofed or
stale evidence. All non-credentialed macOS checks are one-command repeatable.

**Blocked by:** MAC-P0. **Blocks:** MAC-P2, MAC-P3, MAC-P4, and final MAC-P5
candidate freeze.

## MAC-P2: Certify UI, onboarding, accessibility, and packaged workflows

**Outcome:** real macOS interaction matches the deterministic UI behavior.

**Work packages:**

1. Complete keyboard-only navigation for every global, project, task, Chat,
   run, workspace, search, Settings, and recovery destination.
2. Run VoiceOver, 80-200% zoom, narrow/wide layouts, reduced motion, dark/light
   themes, focus, labels, contrast, live regions, and state-recovery checks.
3. Keep the completed exact-Preview onboarding evidence current when its flow
   changes. Focused, Standard, Complete, skip, cancel, interrupted resume,
   rerun, tutorial, reversal, and upgrade-preserved paths now pass.
4. Exercise multi-pane and native multi-window drag, keyboard fallback,
   cross-window transfer, four-window limits, display removal, crash restore,
   saved workspaces, and archived Codex task recovery.
5. Repeat the representative Stage 3 and Stage 4 workflow inside the exact
   Preview package, not only Dev.
6. Fix reproducible product defects at the shared component or platform
   boundary, add the smallest regression test, and rerun the affected matrix.

**Authority:**
[product UI/UX](../openspec/changes/polish-product-ui-ux/tasks.md),
[guided onboarding](../openspec/changes/add-guided-onboarding-visibility/tasks.md),
and
[multi-pane Chats](../openspec/changes/add-terminal-grid-swarm-workspaces/tasks.md).

**Acceptance:** S3-F17, S6-F1, S6-F2, and S6-F6 have exact-candidate macOS Dev
and Preview evidence. VoiceOver, keyboard, zoom, reduced motion, onboarding,
multi-window, and recovery rows pass with no launch-critical inaccessible path.

**Current macOS evidence:** real VoiceOver exposed the core Chat controls and
transcript semantics. The discovered `Control+Option` dictation shortcut
conflict was fixed by moving the macOS default to `Control+Shift+Space`, and
live VoiceOver commands no longer start dictation. The exact installed package
completed 160 real Tab actions across 42 distinct control descriptions. Its
light and dark themes, emulated Reduce Motion, about 200% responsive zoom, and
four-pane restoration passed without horizontal overflow. Disposable
exact-Preview profiles passed Focused, Standard, Complete, skip, cancel,
interrupted restart/resume, rerun, tutorial, reversal, and upgrade-preserved
onboarding paths. The exact package also passes four named accessible Chat
panes, four visible composers, and a real input-response sample. A stale Chat
ownership defect discovered when opening a closed Chat in a new window was
fixed at the workbench ownership boundary with a regression test. The rebuilt
package opened separate `main` and `window-2` renderers and restored both with
correct ownership after restart. Formal contrast measurements, the full
layout/device matrix, native drag and cross-window transfer, four-window and
display/crash behavior, and owner review remain open.

**Blocked by:** remaining owner visual review plus the display/crash/window
matrix. Visible-UI permission for this pass is already supplied. **Blocks:**
MAC-P6.

## MAC-P3: Certify native hardware and operating-system lifecycle

**Outcome:** macOS permissions, devices, lifecycle events, and long-running
behavior work outside fixtures.

**Work packages:**

1. Voice: test microphone allow, deny, revoke, no-device, device switch,
   recording, Whisper, Parakeet, cloud STT, system TTS, Kokoro playback/cache,
   interruption, restart, and packaged behavior.
2. Capture: test Screen Recording allow, deny, revoke, screen, window, region,
   multi-display, scaling, protected surfaces, crop, annotation, irreversible
   redaction, cancellation, helper equivalence, and packaged helper lifecycle.
3. Mobile: test HTTPS bridge enable/disable, QR and fingerprint pairing, two
   devices, expiry, replay, revocation, reconnect gaps, unsafe-network refusal,
   bounded steering, approvals, and honest notifications on iOS and Android.
4. Lifecycle: test sleep/wake, lock/unlock, network loss/recovery, display
   changes, app restart, background daemon recovery, and stale process cleanup.
5. Run the 24-hour workload with Chats, multi-pane windows, provider streams,
   voice/capture cycles, mobile reconnects, database maintenance, and resource
   snapshots. Define failure budgets before the run and do not reset them after
   observing results.

**Authority:**
[mobile companion](../openspec/changes/add-stage6-mobile-companion/tasks.md),
[visual capture](../openspec/changes/add-visual-context-capture/tasks.md),
[performance](../openspec/changes/harden-product-performance/tasks.md), and the
voice rows in
[owner testing](owner-manual-testing-backlog.md).

**Acceptance:** S2-A, S3-F9, S5-F7, S6-F4, S6-F5, and S6-F9 pass on real macOS
hardware. Sleep/wake and the 24-hour run leave no data loss, credential leak,
or orphaned owned process.

**Current macOS evidence:** microphone access, record, stop, and honest silent
input handling pass in Dev and the exact Preview package. Packaged Kokoro and
Native OS Voice message playback both exposed live progress and rate controls;
the original Kokoro selection was restored. Screen Recording enumerated the
display and real application windows; one Flapstack-window capture passed
redaction, derivative preview, SHA-256/provenance/retention storage, history,
and composer attachment. The live attachment pass found and fixed renderer
data-URL decoding. Deterministic cancellation and raw-frame purge, selected-only
export, missing-byte detection, and tamper refusal also pass. The installed app
contains no standalone capture helper executable; only the shared in-app/helper
safety contract exists, matching the still-open release-evidence row. Device
and cloud-engine matrices, recognition quality, multi-display, protected
surfaces, the helper package lifecycle, mobile devices, lifecycle events, and
the soak remain open.

**Blocked by:** MAC-P1, real devices, macOS permissions, and a dedicated soak
window. **Blocks:** MAC-P6.

## MAC-P4: Certify providers, local services, remotes, and interoperability

**Outcome:** every advertised optional integration has truthful macOS live
behavior and failure recovery.

**Work packages:**

1. Providers: run fresh login, streaming, reasoning, permissions, tool use,
   stop, resume, restart, usage, logout, and network-loss matrices for Claude,
   Codex, Cursor, OpenRouter, NanoGPT, OpenCode/native, and supported runtime
   modes.
2. Orchestration: run Codex to Claude, Claude to Codex, same-provider,
   mixed-runtime, budget stop, partial failure, retry, cancellation, restart,
   and lineage/navigation flows.
3. Usage: reconcile provider facts, backfill, rollups, forecasts, budgets,
   alerts, webhooks, exports, daemon catch-up, and organization Admin usage.
4. Ollama: discover a real catalog, launch a persisted Chat, stream, run
   read/write/exec permission tiers, report missing capabilities honestly, and
   recover from service/model loss.
5. Private sync: export without secrets, link a disposable private remote,
   push/pull, diverge, resolve, unlink, recover, and verify no credential or
   excluded data enters Git.
6. Obsidian: open the same central and project-owned folders, round-trip
   frontmatter, Wikilinks, headings, blocks, aliases, embeds, attachments,
   external rename/delete, conflicts, graph rebuild, Git state, and app restart.
7. For every failure, distinguish external rejection from Flapstack defect.
   Fix only confirmed product defects and keep unsupported provider capability
   states explicit.

**Current macOS evidence:** basic Cursor Chat operation passes with persisted
status, session, response, and token counts. Exact installed-Preview
OpenRouter DeepSeek V4 Pro and NanoGPT DeepSeek Latest project Chats now pass
with the requested exact responses, reasoning activity, persisted success, and
token usage. Both providers also pass a read-only `package.json` tool call and
persisted cancellation with sidecar cleanup. A real first-run delay reproduced
the original OpenRouter failure; the sidecar startup and local request limits
are now 60 seconds, with focused and real pinned-sidecar regression evidence.
Continuation testing found and fixed hidden Product MCP envelope echo plus an
invalid attempt to fork a previous isolated sidecar's session. The rebuilt
NanoGPT Chat now resumes through router-rebuilt context and persists the exact
clean response. The global Chat first-run defect is also fixed: global Chats
receive an isolated app-owned runtime directory without a project association,
and the exact installed Preview returned `OPENROUTER_GLOBAL_OK` with a
successful persisted run and no hidden marker. OpenRouter DeepSeek V4 Pro and
NanoGPT GLM Latest also close the permission item: both persisted one-time file
and shell approvals plus a rejected edit, and the denied files were absent.
NanoGPT DeepSeek Latest returned malformed model output without requesting a
tool in two attempts, so keep that model-specific limitation explicit. The next
provider work is network-loss recovery and billing reconciliation. The clean
post-fix OpenRouter continuation lane now passes with exact resumed context and
no Product MCP marker. The final installed package also hides legacy persisted
Product MCP envelopes during assistant-message hydration without altering user
or tool parts; the historical NanoGPT transcript rendered both prior exact
responses cleanly.
Real Obsidian 1.13.7 passes basic
edit/adopt/link/tag/write-back round trips for app-managed and project-owned
vaults. External project-owned rename preserves stable identity and now
refreshes the open Flapstack custom-note list automatically after a watcher
graph rebuild. External move and selected-note rename also preserve identity
and live selection. A real native-picker PNG passed verified upload, metadata,
rename, move, recoverable trash/restore, Obsidian indexing, and restart with the
same SHA-256. Concurrent Flapstack and Obsidian edits now preserve the dirty
draft and disk version, show an exact diff, support Keep both with distinct
stable IDs, and require explicit external adoption. The Finder extension-filter
and custom-note draft invalidation defects found by these checks are fixed. The
external-delete lane also passes: the note disappears from the live tree, then
returns with its selection and unsaved draft when the same stable-ID file is
restored. A note authored through real Obsidian indexed its Unicode heading,
YAML alias and tag, inline tag, aliased heading Wikilink, relative Markdown
link, block link, and safe raster embed candidate without source rewriting.
All three note targets resolved exactly; the attachment remained a non-note
target. The disposable fixture was moved to macOS Trash without removing the
attachment. Deleting the disposable project's derived graph rows exposed the
expected recovery surface, and a UI rebuild reproduced the exact prior source
fingerprint with 8 notes and 2 edges. Database integrity and foreign-key checks
passed afterward. An isolated native macOS scale fixture rebuilt 10,000 notes
and 9,999 resolved links, searched the exact alias, and passed integrity and
foreign-key checks in an 11.89-second test body. The project-owned lane stays
absent from Git status. The installed Preview package also passed Project
Memory opt-in, app-managed vault creation, graph build, custom-note
create/edit/save, and automatic graph refresh from two to three nodes. Its
disposable project and Chat were archived afterward, and the external
project-owned files remained unchanged. A separate installed-Preview fixture
created a fresh project-owned vault that real Obsidian opened directly.
Obsidian created a tagged Wikilink note, Preview indexed 3 nodes and 1 resolved
edge, and a later Obsidian edit automatically produced a new generation with
both tags. The fixture remained Git-ignored and was archived after the Obsidian
test window was closed. Official
Ollama 0.33.0 now passes real loopback catalog discovery, persisted read-only
Chat streaming and usage, no-cloud-fallback behavior, and a successful
`qwen3:1.7b` `read_file` call. The Ollama 0.33 `thinking` stream incompatibility
found during the pass is fixed, and unsupported local reasoning is labelled
unavailable. Service-loss refusal without cloud fallback and retry after
Ollama restart also pass. The packaged Preview app discovers the same catalog
and completes a persisted read-only local Chat. Development full access and the
packaged Ask before edits flow both pass real project write and bounded shell
tools with durable evidence. Selected-model loss fails closed before creating a
run, and retry succeeds after the model manifest is restored. The audited Ollama
work package is complete. The current Preview package is installed in
Applications with a matching `app.asar` SHA-256, launches from that exact path,
retains its enabled macOS Accessibility entry, and passes packaged binary plus
usage-daemon lifecycle smokes. A separate installed-Preview profile rendered
10,000 notes and 9,998 resolved edges, filtered the final note responsively,
preserved its exact generation and fingerprint through restart, and passed
database integrity checks. A deliberately corrupted copy failed closed with a
native recovery dialog, preserved the damaged database unchanged, and reopened
the same graph after backup restoration. Private sync passed against the
user-owned private repository
`Micsushi/flapstack-macos-private-sync-proof-20260826`: Flapstack linked only
`scopes/settings/config.json`, produced a secret-safe commit preview, committed,
pushed, pulled an independent update to OID
`3157c3ae71a4fa4f166c3616a5e1352869774640`, verified version 2, and unlinked
local metadata. The remote stayed private, contained no excluded data, and ran
no GitHub Actions. The broader provider matrices, organization Admin usage, and
the exact promoted-artifact walkthrough remain open.

**Authority:** active runtime, usage, local-model, portability, organization,
and knowledge-graph changes:

- [agent runtimes](../openspec/changes/add-agent-runtimes/tasks.md)
- [runtime orchestration](../openspec/changes/complete-runtime-orchestration-composition/tasks.md)
- [advanced usage](../openspec/changes/extend-advanced-usage-limits/tasks.md)
- [local models](../openspec/changes/add-local-model-harness/tasks.md)
- [private sync](../openspec/changes/add-portable-import-export-sync/tasks.md)
- [organization usage](../openspec/changes/add-organization-usage-apis/tasks.md)
- [Obsidian graph](../openspec/changes/add-obsidian-compatible-project-knowledge-graph/tasks.md)

**Acceptance:** all provider/service-dependent rows move from Conditional to
Ready with exact provider/model versions, sanitized transcripts, restart proof,
and honest unsupported states.

**Blocked by:** MAC-P1 and required accounts, credentials, services, models,
remotes, and applications. **Blocks:** MAC-P6.

## MAC-P5: Produce a signed dual-architecture macOS candidate

**Outcome:** one public macOS candidate satisfies the stable distribution
contract on Apple Silicon and Intel.

**Work packages:**

1. Lock supported macOS versions, `arm64` and `x64` artifacts, Preview/stable
   channels, app IDs, protocols, update policy, entitlement set, and credential
   ownership.
2. Configure Developer ID signing, hardened runtime, entitlements, notarization,
   staple verification, and fail-closed CI secret handling.
3. Build native Apple Silicon and Intel DMG/ZIP artifacts from the same immutable
   source revision on declared native runners.
4. Inspect Mach-O architectures, signatures, entitlements, nested helpers,
   bundled CLIs, native modules, licenses, resources, protocols, and daemon
   payloads.
5. Generate SHA-256 checksums, dependency inventory/SBOM, third-party notices,
   secret-scan result, and malware/security report covering every distributed
   file.
6. On clean machines, test download, checksum, mount, drag install, first
   launch, Gatekeeper, permissions, provider login retention, upgrade, rollback,
   recovery, uninstall, and residue ownership.
7. Enable and pass the hosted macOS candidate lane. Never count a skipped lane
   as evidence.

**Authority:**
[cross-platform distribution](../openspec/changes/add-cross-platform-distribution/tasks.md)
and [macOS release operations](releasing-macos.md).

**Acceptance:** S6-F10 is Ready; both architecture artifacts are signed,
notarized, stapled, Gatekeeper-clean, hash-covered, security-reviewed, and pass
clean install through uninstall on the exact revision.

**Blocked by:** MAC-P0, final candidate outputs from MAC-P1 through MAC-P4,
Apple credentials, and native architecture runners. **Blocks:** MAC-P6.

## MAC-P6: Run integrated release acceptance

**Outcome:** one exact candidate is either accepted for macOS or rejected with
specific blocking evidence.

**Work packages:**

1. Freeze revision, version, artifacts, hashes, signing/notarization records,
   machine matrix, provider/model versions, profile types, and all evidence
   paths.
2. Run `npm run check`, strict OpenSpec validation, candidate-ledger validation,
   both architecture package inspections, and all non-credentialed smokes.
3. Run the complete fresh-install and upgrade journey across onboarding,
   projects, Chats, permissions, providers, MCP, voice, usage, automation,
   profiles, multi-agent orchestration, mobile, capture, multi-pane workspaces,
   private sync, local models, organization usage, and Obsidian.
4. Force representative network, provider, process, permission, database,
   device, and restart failures. Verify recovery without secret exposure or data
   loss.
5. Complete independent security/privacy, accessibility/usability, performance,
   artifact, documentation, and owner reviews.
6. Update matrices and
   [macOS feature readiness](macos-feature-readiness.md) only from exact-candidate
   evidence. Record a go or no-go decision and every accepted limitation.

**Authority:**
[Stage 6 release validation](../openspec/changes/validate-stage6-release/tasks.md),
[Stage 6 matrix](stage6-full-feature-test-matrix.md), and
[owner testing](owner-manual-testing-backlog.md).

**Acceptance:** all macOS rows are Ready or N/A, all required owner checks pass,
and the exact signed candidate has no unresolved release-blocking defect.

**Blocked by:** MAC-P2, MAC-P3, MAC-P4, and MAC-P5. **Blocks:** macOS stable
release.

## Stop rules

- A missing credential, device, signing identity, native runner, or visible-UI
  permission pauses only its dependent lane. Independent work continues.
- Three repeated failures from the same external prerequisite mark that lane
  blocked with evidence. They do not justify bypassing security or fabricating a
  pass.
- Any data loss, secret exposure, wrong-process termination, permission bypass,
  or unsigned/notarization mismatch blocks release immediately.
- A provider quota or unsupported capability is not fixed in code unless
  Flapstack reports or handles it incorrectly.
- A new regression gets one shared root-cause fix and the smallest durable test.

## Plan review

**Verdict: plan approved with follow-ups.** The dependency graph is acyclic,
every gap maps to existing authority, and the code-first work can start without
external input. Final completion still requires the owner inputs listed above.
