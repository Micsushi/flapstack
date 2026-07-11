## 1. Baseline and boundary

- [x] 1.1 Record Flapstack `049b1f9`, Flapshot `c0c120b` lifecycle, `e95d0d2`
      hardening, and final `a1fb8a5` integration baseline.
- [x] 1.2 Document external-process, GPL, package, config, and secret boundaries.
- [x] 1.3 Replace provisional compatibility anchor after upstream security/contract fix.

## 2. MCP client and lifecycle

- [x] 2.1 Resolve `flapshot` through existing global/project stdio MCP config.
- [x] 2.2 Validate server identity, tools, resource discovery, and schema versions.
- [x] 2.3 Gate UI actions with unavailable reasons.
- [x] 2.4 Persist operation progress, correlation/audit IDs, cancellation, disconnect, and restart.
- [x] 2.5 Enable and verify recording through public bounded target discovery.

## 3. Attachments

- [x] 3.1 Extend existing attachments with MIME, size, hash, artifact, URI, and provenance.
- [x] 3.2 Validate canonical paths, symlinks, signatures, size, SHA-256, and source identity.
- [x] 3.3 Copy bounded media atomically and keep large video as validated local references.
- [x] 3.4 Detect missing/tampered files and expose verification in the attachment UI.

## 4. Tests and exit

- [x] 4.1 Pass focused capability, lifecycle, integrity, and UI tests.
- [x] 4.2 Pass strict OpenSpec validation.
- [x] 4.3 Pass pinned Node 22 `npm run check` and production build.
- [ ] 4.4 Run installed-app screenshot/recording/manual/package evidence after replacement SHA.
- [x] 4.5 Add fail-closed auth, connection-race, cross-chat owner-binding, stale-discovery,
      and use-time attachment-integrity regressions.
