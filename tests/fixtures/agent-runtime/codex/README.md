# Codex App Server 0.144.1 golden fixture

`app-server-events.jsonl` is a minimal `public-doc-derived` protocol fixture for
S4-F11-T4. It was reduced from generated App Server v2 TypeScript schemas at
Codex tag `rust-v0.144.1`, commit
`44918ea10c0f99151c6710411b4322c2f5c96bea`, inspected 2026-07-14 on macOS
arm64. It is not a credentialed provider capture.

The fixture keeps fake thread, session, turn, item, tool, summary, content, and
section identities needed to test ordering. Prompt/response bodies, account
data, filesystem paths, tool inputs/outputs, credentials, encrypted blobs, and
private reasoning were replaced with fixed markers. `PRIVATE_REASONING_A` is a
deliberate leak sentinel; tests require it never enter a displayable activity
payload.

Protocol drift is fail-closed for unknown execution, item, turn, and permission
semantics. Unknown harmless metadata is depth, entry, string, secret-key, and
payload-size bounded before the T3 append API.

Still unverified: a fresh credentialed run, matched live/provider trace,
Flapstack Dev UI, unsigned Preview package, Windows, and Linux.
