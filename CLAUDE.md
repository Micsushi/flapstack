# CLAUDE.md

Keep repository instructions self-contained. Read `AGENTS.md` before
substantive work, root `ui-design.md` before UI work, and
`openspec/AGENTS.md` for OpenSpec planning or change work.

## Local Commands

```bash
npm run dev
npm run lint
npm run style:check
npm run test
npm run build
npm run check
npm run ts:check
```

`npm run check` and CI both enforce strict TypeScript through `npm run ts:check`.

## Repo Notes

- Flapstack is local-first. Do not add hosted sign-in, hosted sync, release CDN,
  auto-update, or cloud backend dependencies unless explicitly requested.
- OpenSpec instructions stay in `AGENTS.md` and `openspec/AGENTS.md` because
  OpenSpec manages those files.
- Use tRPC for main/renderer app calls. Use `window.desktopApi` only for native
  desktop features such as window controls, clipboard, notifications, and file
  watchers.
- The vertical middle sub-chats **Chats** pane is parked, not deleted. It is
  hidden by `SUBCHATS_SIDEBAR_PANEL_ENABLED=false`; keep sub-chat tabs and quick
  switch as the active navigation path unless a future workflow review changes
  this.
