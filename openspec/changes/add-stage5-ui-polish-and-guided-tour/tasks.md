# Stage 5 UI Polish and Guided-Tour Patch

Reconciled 2026-08-05: P1 through P8 are implemented and covered by the
accepted Stage 6 core gates. The follow-up defects from the owner's latest UI
review are repaired and integrated into `main`; P9 remains open for the final
owner walkthrough and its recorded evidence. The live development instance
still runs from the clean `codex/manual-ui-fixes` worktree.

### S5-P1 — Lock patch scope and ownership

- [x] Completion: proposal, design, specs, and Stage 5/6 routing validate
- Outcome: Stage 5 owns the product tour and listed native polish defects;
  Stage 6 owns only feature-visibility questionnaire/setup behavior.
- Verification: strict OpenSpec validation and documentation link review.

### S5-P2 — Update new-chat model defaults

- [x] Completion: Opus 5 and GPT-5.6 Sol catalog/default tests pass
- Outcome: New Claude chats select Opus 5 and new Codex API-key chats select
  GPT-5.6 Sol; explicit older models remain unchanged.
- Verification: model catalog, runtime-default, migration, and live provider
  smoke tests.

### S5-P3 — Refine the empty shell and navigation motion

- [x] Completion: in-shell home, static chat switching, stable status phrases,
      and reduced-motion tests pass
- Outcome: Flapstack opens into its normal shell and chat navigation feels
  immediate and professional.
- Verification: renderer interaction tests and native Windows walkthrough.

### S5-P4 — Refine sidebar and mode controls

- [x] Completion: sidebar sizing/divider, disclosure, row geometry, and
      Write/Plan/Review interaction tests pass
- Outcome: Navigation density and mode selection are consistent, accessible,
  and migration-safe.
- Verification: component, keyboard, pointer-drag, migration, and fullscreen
  tests.

### S5-P5 — Refine Windows chrome and chat header

- [x] Completion: window icon, titlebar spacing, header actions, title/icon
      baseline, and chip alignment tests pass
- Outcome: Windows chrome is branded and shared header geometry remains correct
  on Windows and macOS.
- Verification: component tests, preview package inspection, and display-scale
  matrix.

### S5-P6 — Make Open In truthful

- [x] Completion: platform/install matrices and renderer menu tests pass
- Outcome: The menu shows the native folder action and only installed,
  platform-valid applications.
- Verification: unit tests plus Windows and macOS package walkthroughs.

### S5-P7 — Deep-link completion notifications

- [x] Completion: same-project, cross-project, subchat, settings, and cold
      renderer cases pass
- Outcome: Clicking a completion notification focuses Flapstack and opens the
  exact conversation.
- Verification: main/preload/renderer tests and packaged Windows notification
  walkthrough.

### S5-P8 — Add the versioned main-page product tour

- [x] Completion: state, coachmark, accessibility, and Settings rerun tests pass
- Outcome: A new normal packaged profile sees one short tour; dev/test profiles
  do not auto-run it; Settings can rerun it.
- Verification: unit/component tests and fresh/existing/dev/test profile matrix.

### S5-P9 — Close the patch

- [ ] Completion: focused suites, `npm run check`, Windows preview inspection,
      and owner-facing evidence are recorded
- Outcome: Every implemented Notion item has current evidence before moving to
  Done.
- Verification: exact commands and screenshots recorded in patch evidence.
