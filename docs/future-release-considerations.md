# Future release considerations

These items are intentionally outside Stage 3 acceptance. Their absence must
not block Stage 3 completion or turn a passing Preview validation into a
release failure.

## Organization usage APIs

- OpenAI Admin organization usage/cost validation (`U6-01`) is deferred.
- Anthropic Admin organization usage/cost validation (`U6-02`) is deferred.
- No OpenAI or Anthropic Admin key is required for Stage 3.
- Existing optional credential fields and adapters may remain, but Stage 3
  makes no live organization-wide accuracy claim for them.
- A future pass can decide whether to retain the surfaces, then test them with
  low-value organization credentials and sanitized provider evidence.

Stage 3 still validates personal Codex and Claude quota sources plus
credentialed Cursor, OpenRouter, and NanoGPT behavior where their separate
matrices require it.

## Public macOS distribution

Stage 3 accepts an unsigned macOS Preview package for local functional,
resource, architecture, migration, and cleanup testing. It does not publish a
public macOS binary.

Before Flapstack publishes DMG or ZIP downloads for general users:

1. Enroll in the Apple Developer Program.
2. Create and install a Developer ID Application certificate.
3. Add notarization credentials and packaging configuration.
4. Sign, notarize, and staple the release artifacts.
5. Verify Gatekeeper installation and first launch on a clean Mac profile.
6. Document certificate ownership, renewal, CI secret handling, and recovery.

Apple signing and notarization are public-distribution gates, not Stage 3
feature-completion gates.

## Windows and Linux acceptance

Stage 3 release acceptance is macOS arm64 only. Native Windows and Linux
package, UI, service, and secret-store validation is deferred to the end of
Stage 4 and does not block Stage 3 completion.

Stage 3 still keeps the shared cross-platform contracts and automated platform
fixtures green. It does not claim native Windows or Linux runtime parity from
macOS evidence. The Stage 4 closeout must run each native matrix on real target
hosts, record any platform-specific repair, and update the support statement
before those platforms are promoted.
