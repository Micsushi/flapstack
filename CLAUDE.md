# CLAUDE.md

Flapstack's durable AI and product docs live in the vault:

- `/Users/michaelshi/Documents/GitHub/agentsvault/Wiki/Projects/flapstack/flapstack_index.md`
- `/Users/michaelshi/Documents/GitHub/agentsvault/Wiki/Projects/flapstack/current-handoff.md`
- `/Users/michaelshi/Documents/GitHub/agentsvault/Wiki/Projects/flapstack/repo-guide.md`
- `/Users/michaelshi/Documents/GitHub/agentsvault/Wiki/Projects/flapstack/design.md`

Read those before substantive work. Keep this file small and repo-local.

## Local Commands

```bash
npm run dev
npm run lint
npm run style:check
npm run test
npm run build
npm run check
```

`npm run ts:check` currently exposes inherited type debt and is not part of CI
until that cleanup is done.

## Repo Notes

- Flapstack is local-first. Do not add hosted sign-in, hosted sync, release CDN,
  auto-update, or cloud backend dependencies unless explicitly requested.
- OpenSpec instructions stay in `AGENTS.md` and `openspec/AGENTS.md` because
  OpenSpec manages those files.
- Use tRPC for main/renderer app calls. Use `window.desktopApi` only for native
  desktop features such as window controls, clipboard, notifications, and file
  watchers.
