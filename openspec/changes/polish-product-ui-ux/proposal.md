# Change: Polish product-wide UI and UX

## Why

Flapstack now exposes a large local agent operating environment, but the result
must become easier to understand, faster to navigate, and more consistent before
wider use. Stage 6 makes product-wide polish a primary feature rather than a
collection of incidental fixes.

## What Changes

- Establish one audited information architecture and reusable design system.
- Refine navigation, chat/run controls, Settings, workspaces, progress, and long-chat navigation.
- Complete dynamic speech vocabulary and voice-input language usability.
- Standardize empty, loading, error, stale, offline, approval, and recovery states.
- Complete keyboard, screen-reader, contrast, zoom, responsive, and multi-window behavior.
- Add visual regression, usability, and manual acceptance gates.

## Impact

- Affected specs: new product-ui-ux capability.
- Affected code: renderer shell, navigation, chats, Settings, workspaces,
  components, styles, accessibility, fixtures, and visual/manual test tooling.
