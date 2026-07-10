# Reasoning output fixtures (Stage 2 Track T — T0)

One file per provider. Each file has a `provider`, a `source`
(`live` = captured from real CLI/API output, `docs` = derived from provider
docs, `repo` = derived from existing Flapstack transform code), and a `cases`
array.

Each case declares the raw single provider event and the `expected` normalized
`ReasoningOutputEvent`s produced by `normalizeReasoningOutput(provider, raw)`
(`src/shared/reasoning-output`). `expected` fields:

- `kind` — `reasoning-output | reasoning-summary | thought | reasoning-tokens | opaque`
- `phase` — `start | delta | final`
- `text` — exact visible text, when the event carries any
- `tokens` — reasoning token count, for `reasoning-tokens`
- `opaque` — `true` when an opaque payload must be preserved (never rendered)

Rules encoded by the fixtures:

- Visible reasoning text is the only thing shown; encrypted payloads stay opaque
  and token counts are usage metadata.
- Absent reasoning is normal (`expected: []`), not an adapter failure — no fake
  chain-of-thought.
- Live streamed deltas are preferred; saved JSONL/session data is backfill only.

Add new shapes here rather than in test code so adapters can be verified without
re-running provider research. Strip secrets, account IDs, prompts, and paths.
