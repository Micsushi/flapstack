# Change: Add visual context and screenshot capture

## Why

Users and agents need bounded visual context for UI work, debugging, and review
without relying on unsafe opaque screenshots or a disconnected helper workflow.

## What Changes

- Add screen/window/region capture with preview, annotation, and redaction.
- Store screenshots as provenance-rich chat attachments/task artifacts.
- Add explicit visual-context selection for agent runs and approved recapture.
- Add history, retention, export, platform permissions, and a standalone helper after in-app proof.

## Impact

- Affected specs: new visual-context capability.
- Affected code: Electron capture/permissions, renderer capture UI, attachments,
  artifacts, knowledge/context selection, MCP/agent tools, portability, and tests.
