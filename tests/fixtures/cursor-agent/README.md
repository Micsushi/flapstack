# cursor-agent stream-json fixtures (Stage 2 Track D / D0)

`cursor-agent` is installed + logged in on the dev machine as of 2026-07-09
(v2026.07.08-0c04a8a, `~/.local/bin/cursor-agent`, sanitized test account).

These fixtures back the D2 adapter's stream translator
(`src/main/lib/cursor/stream.ts`) so tests do not depend on the live CLI. The
Cursor stream-json contract iterates quickly and its docs currently say print
mode suppresses reasoning output, while a live `--stream-partial-output --model auto`
run on this machine DID emit provider `thinking` deltas. The translator is
therefore tolerant: it renders reasoning output when present and never depends on it.

Capture command used:

```bash
cursor-agent -p --output-format stream-json --stream-partial-output \
  --model auto --workspace "$PWD" <<<'Say hello and think briefly first.'
```

## Files

- `reasoning-output-run.jsonl` — a run that emitted provider `thinking` delta/completed events
  before assistant text (the observed-on-this-machine shape).
- `no-reasoning-output-run.jsonl` — the docs-suppressed fallback: assistant text only,
  no `thinking` events. The adapter must still produce a complete reply.

## Regenerating

Re-run the capture command and overwrite these files when Cursor changes its
output. Keep both a reasoning-output and no-reasoning-output fixture so the tolerance
guard (D2/T5) stays covered.
