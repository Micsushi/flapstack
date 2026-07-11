# Flapshot MCP Client

Status: macOS client wire compatibility is pinned to the replacement Flapshot
Stage 3 lifecycle checkpoint. Installed-app manual evidence remains open.

## Baselines

- Flapstack implementation base: `049b1f928f73eb02297b3f117724304f7a9211cf`.
- Flapshot final Stage 3 integration reference: `e693bc941fe670191fa065055967931fc90c2a43`.
- Hardened client/schema predecessor: `e95d0d2bf965140bc276fcc3c3c90b82c7edaec9`.
- Lifecycle/pairing predecessor: `c0c120ba21296ddeb5c192c833918b790ebf57a7`.
- MCP server identity at that reference: `flapshot` `0.1.0`.
- Application envelope and screenshot, recording, artifact, operation, and system
  schemas: version 1.
- MCP limits: 1 MiB input messages and 512 KiB tool responses. Media stays
  file-backed.

This checkpoint provides live human pairing, a random zero-authority unpaired
connection, per-connection sessions, same-session approval retries, bounded recording
targets, authenticated resource grants, real export adapters, and audit artifact IDs.
The final contract replaces raw project `existingPath` inputs with opaque path/write
capabilities. Flapstack does not invoke project methods. Recording target parsing accepts
string window IDs and exact region bounds, display bounds, and scale-factor fields.
Agent artifact exports are pathless and remain inside Flapshot's configured export root;
agent artifact actions cannot supply `open-with` or a raw application path. Flapstack's
capture client does not invoke those artifact actions.

## Process and License Boundary

Flapstack uses the official MCP SDK to spawn an ordinary external stdio server.
It does not import, link, copy, package, or execute a Flapshot module inside the
Flapstack process. It does not share a database or call a private Flapshot API.
Flapshot is installed and updated separately.

Repository and package review must confirm that no Flapshot source, GPL runtime,
application bundle, native helper, or media library enters the Flapstack artifact.

## Configuration

Add a global or project MCP server named `flapshot` using Flapstack's existing MCP
settings. Only stdio is accepted by the direct capture client. HTTP configuration is
rejected.

Preferred installed launcher form:

```json
{
  "mcpServers": {
    "flapshot": {
      "command": "flapshot-mcp",
      "args": []
    }
  }
}
```

Direct application-resource fallback:

```json
{
  "mcpServers": {
    "flapshot": {
      "command": "<Flapshot.app>/Contents/MacOS/Flapshot",
      "args": ["<Flapshot.app>/Contents/Resources/mcp/flapshot-mcp.js"],
      "env": {
        "ELECTRON_RUN_AS_NODE": "1"
      }
    }
  }
}
```

Use the dedicated `flapshot-mcp` launcher when it is on `PATH`. The direct resource
form is only a fallback for package troubleshooting. Replace its application
placeholder locally; do not commit a machine path.

Flapstack applies its normal MCP environment filtering. Provider tokens and common
cloud credentials are not inherited by the child process. Configuration must not
contain secrets.

## Discovery and Actions

Flapstack reads `flapshot://v1/capabilities`, verifies the server identity and
application schema versions, cross-checks discovered tools against `tools/list`, and
enables actions only when the matching application method is available. Unavailable
actions keep the server reason in the UI.

Each stdio process starts as a random unpaired connection with zero capture authority.
Flapstack requires the dedicated MCP transport-auth tool
`flapshot_system_auth_status`, detected from MCP `tools/list` rather than the frozen
application catalog. It validates the exact response request correlation, displays the
six-digit pairing code, and keeps capture disabled until the user pairs that live
connection in Flapshot **Agent access**. If the tool is absent or pairing is unknown,
capture stays disabled. Flapstack never calls Flapshot's private local transport.
Pairing ends on disconnect; reconnect displays a new code.

Screenshot uses public bounded screenshot targets. Recording uses
`recording.listTargets` and selects the first supported display descriptor. Flapstack
passes the returned `sourceId` and numeric `displayId` unchanged; it never derives or
guesses native source IDs. Recording is bounded to five minutes, 30 fps, no audio, and
at most 3840 by 2160 pixels.

## Attachment Contract

On successful completion Flapstack validates:

- operation ID, request ID, correlation ID, and audit correlation ID;
- managed artifact ID when present;
- exact `flapshot://v1/artifacts/{artifactId}/file-reference` URI;
- canonical absolute local path and no final symlink;
- approved image/video MIME type and file signature;
- exact byte size and SHA-256;
- source provenance and bounded JSON metadata.

Images are capped at 64 MiB. Videos are capped at 2 GiB. Images and videos up to
128 MiB are copied into Flapstack's existing attachment store and re-hashed before
atomic commit. Larger videos remain validated local references. Missing, changed,
replaced, or MIME-mismatched files become `missing` or `tampered`; they are never
reported as successful attachments.

## Lifecycle

Flapstack stores operation, request, correlation, audit, client, session, progress,
terminal error, and attachment linkage in SQLite. Every refresh must match the accepted
operation, request, client, session, and response metadata before update or ingestion.
Cross-chat recovery rebuilds scope from each stored chat instead of the chat that
triggered polling. Cancel calls the public operation-cancel tool. Disconnect marks
nonterminal client operations interrupted.

The default Flapshot `confirm` profile may return `APPROVAL_REQUIRED`. Flapstack tells
the user to approve in Flapshot and retry without reconnecting. Flapshot binds the
in-memory queued approval to the same live connection, action, and argument digest.

No terminal state is inferred from transport success alone.

Every later attachment read or worktree copy revalidates canonical path, grant expiry
for uncopied references, MIME, size, and SHA-256. Worktree publication copies through a
same-directory temporary file, verifies copied bytes, then publishes atomically. A
missing, expired, or changed source is marked and rejected at use time.

## Verification

Focused checks:

```bash
npx vitest run \
  tests/flapshot-mcp-capabilities.test.ts \
  tests/flapshot-mcp-lifecycle.test.ts \
  tests/flapshot-attachment-integrity.test.ts \
  tests/flapshot-ui.test.ts
```

Full gate:

```bash
npm run check
npx -y @fission-ai/openspec validate add-flapshot-mcp-client --strict --no-interactive
```

Manual evidence still required:

- installed unsigned/signed app launch and approval UI;
- real screenshot capture, cancel, denial, disconnect, reconnect, and app restart;
- real recording target discovery, start, stop, cancel, and large-video reference;
- missing/tampered managed files and expired/revoked path grants;
- package scan proving no Flapshot/GPL payload in Flapstack.
