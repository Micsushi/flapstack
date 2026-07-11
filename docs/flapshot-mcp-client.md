# Flapshot MCP Client

Status: macOS client wire compatibility is pinned to the replacement Flapshot
Stage 3 lifecycle checkpoint. Installed-app manual evidence remains open.

## Baselines

- Flapstack implementation base: `049b1f928f73eb02297b3f117724304f7a9211cf`.
- Flapshot lifecycle schema reference: `c0c120ba21296ddeb5c192c833918b790ebf57a7`.
- MCP server identity at that reference: `flapshot` `0.1.0`.
- Application envelope and screenshot, recording, artifact, operation, and system
  schemas: version 1.
- MCP limits: 1 MiB input messages and 512 KiB tool responses. Media stays
  file-backed.

This checkpoint provides live human pairing, a random zero-authority unpaired
connection, per-connection sessions, same-session approval retries, bounded recording
targets, authenticated resource grants, real export adapters, and audit artifact IDs.

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

Generic launcher form:

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

Installed macOS application form:

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

Replace the application placeholder locally. Do not commit a machine path. The
checkpoint has no dedicated `flapshot-mcp` launcher, so installed-app launch remains
a package/manual gap.

Flapstack applies its normal MCP environment filtering. Provider tokens and common
cloud credentials are not inherited by the child process. Configuration must not
contain secrets.

## Discovery and Actions

Flapstack reads `flapshot://v1/capabilities`, verifies the server identity and
application schema versions, cross-checks discovered tools against `tools/list`, and
enables actions only when the matching application method is available. Unavailable
actions keep the server reason in the UI.

Each stdio process starts as a random unpaired connection with zero capture authority.
Flapstack reads `system.authStatus`, displays the exact six-digit pairing code, and
keeps capture disabled until the user pairs that live connection in Flapshot **Agent
access**. Pairing ends on disconnect; reconnect displays a new code.

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

Flapstack stores operation, request, correlation, audit, progress, terminal error,
and attachment linkage in SQLite. The UI polls this local record. Cancel calls the
public operation-cancel tool. Disconnect marks nonterminal client operations
interrupted. Reconnect queries public operation state and reconciles it when the
server still has the operation.

The default Flapshot `confirm` profile may return `APPROVAL_REQUIRED`. Flapstack tells
the user to approve in Flapshot and retry without reconnecting. Flapshot binds the
durable queued approval to the same connection, action, and argument digest.

No terminal state is inferred from transport success alone.

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
