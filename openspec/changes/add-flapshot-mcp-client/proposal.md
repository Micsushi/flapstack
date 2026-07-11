# Change: Add Flapshot external MCP client

## Why

Flapstack needs a local capture integration that uses its existing MCP and attachment
boundaries without absorbing Flapshot code, runtime, storage, or licensing obligations.

## What Changes

- Discover an external stdio MCP server named `flapshot` through existing MCP config.
- Gate macOS screenshot and recording actions on public capability discovery.
- Persist correlated operation lifecycle, cancellation, disconnect, restart, and errors.
- Ingest bounded image/video files or validated large-video local references through the
  existing attachment system.
- Validate artifact identity, resource URI, path, MIME signature, size, SHA-256, and
  provenance before accepting media.

## Impact

- Affected specs: `flapshot-mcp-client` (new), `chat-attachments` (modified)
- Affected code: MCP client/config, SQLite schema, tRPC, attachment ingestion, active-chat
  capture UI, tests, and integration documentation
- Platform: macOS only for this change
