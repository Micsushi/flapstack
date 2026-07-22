# S6-F5 — Visual Context and Screenshot Capture

### S6-F5-T1 — Lock capture sources, privacy, retention, and agent authority

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S6 / Feature S6-F5
- Outcome: Supported sources, consent, redaction, metadata, retention, and agent boundaries are explicit.
- Scope: OS capability matrix; source/action catalog; visible consent; approval; original/derivative policy; metadata/redaction; secrets; retention; export; helper boundary; threat model.
- Out of scope: Capture implementation.
- Acceptance: Continuous/hidden capture and webcam are excluded; every stored field and agent action has purpose and authority.
- Verification: Privacy/security/UX review and contract tests.
- Blocked by: accepted Stage 5 baseline, including Stage 4 attachments/knowledge/workspaces
- Blocks: S6-F5-T2, S6-F5-T3, S6-F5-T4, S6-F5-T5, S6-F5-T6, S6-F5-T7
- Context: Electron desktopCapturer, permissions, attachments, audit.

### S6-F5-T2 — Implement platform-aware screen/window/region capture

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S6 / Feature S6-F5
- Outcome: Supported platforms produce one bounded raw frame with explicit source identity.
- Scope: Source enumeration; screen/window/application/region; macOS permission; Windows/Linux capability paths; cancellation; display scaling; multi-monitor; protected-content failures; no stale reuse.
- Out of scope: Annotation and persistence.
- Acceptance: Cancel stores nothing; selected source matches preview; revoked permission fails visibly; memory/size is bounded.
- Verification: Capture unit/fixture tests plus real multi-monitor and permission walkthrough on each supported OS.
- Blocked by: S6-F5-T1
- Blocks: S6-F5-T3, S6-F5-T8
- Context: Electron capture APIs, platform permission diagnostics.

### S6-F5-T3 — Build preview, crop, annotation, and irreversible redaction

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S6 / Feature S6-F5
- Outcome: Users understand and sanitize the exact image before any downstream use.
- Scope: Preview; crop; arrows/boxes/text; pixel/solid redaction; undo within editor; metadata stripping; derivative hash; accessibility; large-image performance.
- Out of scope: OCR-based automatic redaction claims.
- Acceptance: Redacted source pixels cannot be recovered from derivative/export; cancel stores nothing; preview hash matches persisted derivative.
- Verification: Pixel/hash/metadata/undo/cancel tests, keyboard/zoom/accessibility, and visual fixtures.
- Blocked by: S6-F1-T2, S6-F5-T1, S6-F5-T2
- Blocks: S6-F5-T4, S6-F5-T5, S6-F5-T6, S6-F5-T7
- Context: image attachment preview, canvas/editor primitives.

### S6-F5-T4 — Integrate visual artifacts with chats, tasks, knowledge, and runs

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S6 / Feature S6-F5
- Outcome: Confirmed images become normal scoped artifacts and exact optional run context.
- Scope: Schema/provenance; attachment/task artifact; knowledge link; context selector; immutable run hash; thumbnail/viewer; move/copy; archive; search metadata; migration.
- Out of scope: Automatic vision-model selection.
- Acceptance: Unselected visuals never enter run context; scope moves preserve ownership; legacy images remain readable without fake provenance.
- Verification: Migration, attachment/artifact/context/search/archive/move/restart tests.
- Blocked by: S6-F5-T1, S6-F5-T3
- Blocks: S6-F5-T5, S6-F5-T6, S6-F5-T7, S6-F5-T8
- Context: attachments, artifacts, project vault, launch context.

### S6-F5-T5 — Add approval-gated agent visual-context operations

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S6 / Feature S6-F5
- Outcome: Approved agents request capture or read selected artifacts without hidden focus theft or expanded authority.
- Scope: Read existing selected artifact; request new capture; caller/scope; approval; user source selection; compact MCP/tool contracts; audit; cancellation; invalidation.
- Out of scope: Autonomous background recapture or remote desktop.
- Acceptance: Agent cannot choose an unapproved source; background request never steals focus; denials/timeouts store no frame.
- Verification: Permission/approval/caller/scope/timeout/focus/audit tests and live agent request walkthrough.
- Blocked by: S6-F5-T1, S6-F5-T3, S6-F5-T4
- Blocks: S6-F5-T8
- Context: app-control MCP, questions/approvals, attachment tools.

### S6-F5-T6 — Add visual history, retention, cleanup, and export

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S6 / Feature S6-F5
- Outcome: Users inspect provenance, remove captures, and export only selected secret-scanned derivatives.
- Scope: History/filter; provenance details; retention settings; orphan cleanup; secure deletion best effort; export/import; missing files; quota/size diagnostics; audit.
- Out of scope: Cloud photo library.
- Acceptance: Cleanup never removes referenced artifacts; exports exclude originals unless chosen; missing/tampered hashes show explicit state.
- Verification: Retention/reference/tamper/export/import/rollback/quota/restart tests.
- Blocked by: S6-F5-T3, S6-F5-T4
- Blocks: S6-F5-T7, S6-F5-T8
- Context: portability registry, artifact references, database maintenance.

### S6-F5-T7 — Extract the optional standalone capture helper

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S6 / Feature S6-F5
- Outcome: A minimal local helper opens the same capture/preview flow and returns artifacts to Flapstack safely.
- Scope: In-app acceptance gate; helper packaging; single-instance/local authentication; hotkey/menu entry; capture service reuse; target selection; offline app state; uninstall; platform permissions.
- Out of scope: Separate storage, sync, agent runtime, or hidden daemon capture.
- Acceptance: Helper cannot bypass consent/redaction/scope; no second database; unavailable Flapstack state fails safely.
- Verification: Contract-equivalence tests, install/start/capture/cancel/uninstall on supported platforms, security review.
- Blocked by: S6-F5-T3, S6-F5-T4, S6-F5-T6, S6-F10-T1
- Blocks: S6-F5-T8
- Context: shared capture service, protocol/deep-link, package config.

### S6-F5-T8 — Close visual-context acceptance

- [ ] Completion: acceptance and verification passed
- Parent: Project Flapstack / Stage S6 / Feature S6-F5
- Outcome: In-app and helper capture, redaction, artifacts, agent requests, lifecycle, and platform permissions pass one exact build.
- Scope: Matrix S6-VC; real OS capture; multiple displays; accessibility; secrets/redaction; context truth; package/helper; docs; recovery.
- Out of scope: Webcam and continuous capture.
- Acceptance: No unconfirmed pixel reaches consumers; platform gaps remain explicit; provenance/hash/audit agree.
- Verification: Node 22 npm run check, strict OpenSpec, verified Dev, native platform matrix, security/accessibility review, packaged preview.
- Blocked by: S6-F5-T2, S6-F5-T4, S6-F5-T5, S6-F5-T6, S6-F5-T7
- Blocks: S6-F11-T3, S6-F11-T4, S6-F11-T5
- Context: docs/stage6-full-feature-test-matrix.md.
