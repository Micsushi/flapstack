# Change: Complete Settings Reliability

## Why

Settings currently mixes working controls with legacy, scaffolded, unsafe, or
partially wired surfaces. A visible control implies that Flapstack can apply it
reliably, but several controls either have no runtime consumer, overstate a
provider guarantee, expose only a Claude implementation, or persist secrets in
renderer local storage.

The immediate release-safe action is to hide those surfaces without deleting
stored values. The follow-on work needs one implementation plan that defines
what evidence is required before each feature can return.

## What Changes

- Hide Legacy Beta, Future Scaffolds, and retired Profile/Worktree routes from
  Settings navigation, content routing, and search. Keyboard and Custom Agents
  are visible only after their S3-F8 and S3-F11 promotion gates pass.
- Hide the Models API-key/model-override editor, the retired Quick Switch
  preference, and incomplete permission modes while preserving existing data.
- Add a single release-eligibility contract so navigation, direct tab IDs,
  search, and runtime behavior cannot disagree about visibility.
- Rebuild editable keyboard shortcuts around one action/binding registry.
- Repair Voice settings so adapter/model selection, offline preference, history
  insertion, and playback speed affect the real runtime paths; absorb the
  unfinished streaming, history, license, and Voice exit work into S3-F9.
- Move renderer-stored credentials behind a main-process encrypted credential
  service with acknowledged migration and an honest session-only fallback.
- Make skills, commands, plugins, and custom agents provider-scoped and prevent
  duplicate or mislabeled identities. Third-party provider MCP entries remain
  separate from Flapstack's product app-control and development test MCPs.
- Promote `custom` and `auto-edit-project-only` permission modes only when their
  provider enforcement and limitations meet the specified eligibility gates.
- Make visible copy and Settings search derive from the same provider and
  visibility facts as the controls they describe.

## Stage 3 Placement

- S3-F7: Honest Settings Surface
- S3-F8: Keyboard Shortcuts
- S3-F9: Voice Settings
- S3-F10: Secure Credentials
- S3-F11: Provider-Scoped Extensions
- S3-F12: Permission Mode Promotion
- S3-F13: Copy and Search Consistency, including the final Settings gate

## Delivery Estimate

These are engineering estimates for one developer with current repository
context. Manual provider or packaged-platform checks can extend elapsed time
when credentials or machines are unavailable.

| Feature                                    |                                     Estimate | Main uncertainty                                         |
| ------------------------------------------ | -------------------------------------------: | -------------------------------------------------------- |
| Honest Settings surface and release gating |                          0.5-1 day remaining | Verified live Settings evidence                          |
| Working keyboard shortcut editor           |                                     3-5 days | OS-reserved keys and input-focus conflicts               |
| Voice Settings reliability                 |                                     5-9 days | Streaming/history integration and packaged audio paths   |
| Secure credential management               |                                     5-8 days | Cross-platform keychain behavior and legacy migration    |
| Provider-scoped extensions                 |                                    7-12 days | Provider discovery/runtime parity and identity migration |
| Complete permission modes                  | 6-10 days after the active permission change | Exact provider enforcement, especially Cursor            |
| Copy and search consistency                |                                     1-2 days | Dynamic provider labels and registry coverage            |

Added Stage 3 scope totals about 5-8 sequential engineering weeks. With
keyboard, voice, credentials, and extension work split across two independent
lanes after shared registries land: about 3-5 elapsed weeks.

## Impact

- Affected specs: new `settings-reliability` capability; related active
  `voice-io`, `run-permissions`, and `settings-navigation` changes remain the
  authority for their underlying runtime contracts.
- Affected code: Settings registry/sidebar/content/search, preference and model
  tabs, shortcut action/binding manager, speech settings/history/playback,
  credential IPC and persistence, provider extension discovery, permission
  adapters, and focused UI/runtime tests.
- Data: the hiding phase does not delete or rewrite persisted values. The later
  credential phase removes legacy plaintext only after encrypted persistence is
  acknowledged and verified.
- Dependencies: S3-F9 is the sole authority for unfinished Voice streaming and
  exit work; permission-mode promotion follows unfinished closeout and exact
  scoped-custom semantics in `sync-provider-permissions-globally`.

## Current Status

The hiding implementation, focused regression tests, strict OpenSpec
validation, and the full Node 22 repository gate are complete in this checkout.
A verified live Settings smoke remains unchecked. S3-F9 now owns the migrated
Voice remainder. Per-chat custom MCP toggles exist, but all-chat custom remains
blocked until S3-F12 adds durable hierarchy defaults. Other feature repairs
remain planned and unchecked. S3-F11 now has provider-scoped contracts,
Claude/Codex/Cursor/OpenCode discovery, and provider-filtered Settings coverage.
Mutation adapters are implemented only for documented provider paths, but
OpenCode-backed paths remain explicitly read-only because managed sidecars do
not consume those provider directories. S3-F11-T4 passed exact live consumption
for every advertised writable provider/kind path. S3-F11-T5 remains open until
the SHA-bound live Settings and package/platform matrix passes.
