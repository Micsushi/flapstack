## 1. Single-conversation contract

- [x] 1.1 Add a canonical internal-conversation resolver used by active chat,
      persisted selection, search navigation, and export. Acceptance: a new chat
      resolves its only row; a legacy multi-row chat resolves the persisted
      valid row or the earliest valid row deterministically. Verification:
      focused resolver and persistence tests. Blocked by: none. Blocks: 1.2,
      2.1, 3.1.
- [x] 1.2 Prevent normal application paths from creating a second internal
      conversation for a sidebar chat. Acceptance: new chat creation still
      creates the required single storage row; menus, hotkeys, provider-switch
      actions, and recovery flows cannot append another nested row. Verification:
      router and renderer tests plus repository search for creation callers.
      Blocked by: 1.1. Blocks: 2.1, 4.1.

## 2. Remove nested chat UI

- [x] 2.1 Remove the top nested-chat tabs, `+`, clock/history quick switch,
      split-view controls, and nested pin/archive/rename surfaces from desktop
      and mobile chat UI. Acceptance: each sidebar item opens one transcript and
      none of the removed actions remain reachable. Verification: focused
      component tests and manual desktop/mobile inspection. Blocked by: 1.1,
      1.2. Blocks: 2.2, 4.1.
- [x] 2.2 Remove obsolete nested-navigation hotkeys, menu registrations, state
      hydration, and user-facing terminology while retaining only compatibility
      state needed for the canonical row. Acceptance: no visible `sub-chat`
      language or dead shortcut remains. Verification: typecheck, lint, and
      targeted repository search. Blocked by: 2.1. Blocks: 4.1.

## 3. Preserve search and export

- [x] 3.1 Route message search results to the owning sidebar chat and canonical
      visible conversation, while keeping left-sidebar global search intact.
      Acceptance: result navigation reaches and highlights the matched visible
      message without the removed history control. Verification: scoped-search
      router/navigation tests. Blocked by: 1.1. Blocks: 4.1.
- [x] 3.2 Update full-history copy behavior and wording for one visible
      conversation while retaining recoverability of hidden legacy rows.
      Acceptance: current conversation exports normally; legacy rows are not
      deleted and, when exported, are clearly labeled as recovery content.
      Verification: export formatter tests using one-row and multi-row fixtures.
      Blocked by: 1.1. Blocks: 4.1.

## 4. Compatibility and full verification

- [x] 4.1 Add migration-compatibility coverage for new chats and legacy chats
      with several internal rows. Acceptance: no row or message is lost, one
      stable conversation opens, provider runs still target the canonical row,
      and restart preserves selection. Verification: focused database/router/UI
      tests followed by `npm run check`. Blocked by: 1.2, 2.1, 2.2, 3.1, 3.2.
      Blocks: 4.2.
      Current verification: focused compatibility tests, Electron ABI,
      `dev:verify`, live UI, and strict OpenSpec passed. On integration SHA
      `73a8347`, Node 22 `npm run check` passed lint, style, TypeScript, 99 test
      files with 724 passed and 3 skipped, and the production build.
- [x] 4.2 Update `README.md` and `ui-design.md` to state that one sidebar chat is
      one conversation and that the internal compatibility row is not a product
      concept. Acceptance: no current product-direction text endorses visible
      sub-chat tabs, quick switch, or split view. Verification: documentation
      search and diff review. Blocked by: 4.1. Blocks: none.
