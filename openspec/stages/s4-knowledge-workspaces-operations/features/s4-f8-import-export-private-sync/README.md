# S4-F8 — Import/Export and Private Sync

- Outcome: versioned selective export/import plus optional user-owned private
  git sync for settings, configuration, knowledge, and selected history.
- Change: `openspec/changes/add-portable-import-export-sync/`
- Tasks: `openspec/changes/add-portable-import-export-sync/tasks.md`
- Task IDs: S4-F8-T1 through S4-F8-T8
- Dependencies: S4-F1 extension policy, S4-F2 vaults, and S4-F4 workspaces.
- Safety boundary: dry-run diff before import; secrets excluded unless a later
  encrypted opt-in contract is explicitly approved.
- Non-goal: hosted Flapstack sync.
