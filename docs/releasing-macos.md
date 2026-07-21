# macOS releases

Flapstack `0.1.0` is a macOS-only public beta. A `v0.1.0` tag on the current
`main` commit triggers GitHub Actions to build separate Apple Silicon and Intel
DMGs on matching native GitHub-hosted Macs, run package checks, generate
SHA-256 checksums, and publish a GitHub release.

The `0.1.0` apps are intentionally **unsigned and not notarized by Apple**. No
Apple Developer membership or signing secrets are required. macOS will warn
that Apple cannot verify the developer or check the app for malicious software.
The published release body comes from [releases/0.1.0.md](releases/0.1.0.md).

## Install the unsigned beta

1. Download the DMG matching the Mac: `arm64` for Apple Silicon or `x64` for an
   Intel Mac.
2. Download `SHA256SUMS.txt` from the same GitHub release. In Terminal, run
   `shasum -a 256 Flapstack-0.1.0-*.dmg` and confirm the result matches the
   listed checksum.
3. Open the DMG and drag Flapstack to Applications.
4. Try to open Flapstack once. If macOS blocks it, open **System Settings →
   Privacy & Security**, find the Flapstack security message, choose **Open
   Anyway**, then confirm **Open**.

Only bypass the warning for a DMG downloaded from the official
`Micsushi/flapstack` release page whose checksum matches. Apple documents this
exception flow in [Safely open apps on your Mac](https://support.apple.com/en-ca/102445).

## Release safety checks

Before making the repository public:

- Run a secret scan across the current tree and complete Git history.
- Confirm the Apache-2.0 license and bundled third-party notices are present.
- Confirm `.env`, credentials, tokens, local databases, and generated packages
  are ignored and absent from Git history.

Before promoting the beta as stable, run these on a clean production profile:

- First launch offers Claude, Codex, and local-only setup without requiring a
  hosted Flapstack account.
- Claude browser login completes, one Chat run succeeds, app restart keeps the
  local login, and a second run succeeds without another prompt.
- Claude explicit disconnect shows disconnected, reconnect succeeds, and a
  sleep/wake plus 30-minute idle cycle does not invent a disconnect.
- Codex ChatGPT login completes, one Chat run succeeds, app restart keeps the
  local login, and a second run succeeds without another prompt.
- Codex explicit logout shows disconnected, reconnect succeeds, and a
  sleep/wake plus 30-minute idle cycle does not invent a disconnect.
- A brief network loss produces an actionable run error; restoring the network
  allows a new run without deleting local credentials.
- Advanced Stage 4 surfaces are off by default and can be enabled individually
  under **Settings → Beta Features**.
- The exact candidate passes `npm run check`, both architecture inspections,
  bundled-runtime smoke, and checksum generation.

## Publish `0.1.0`

After the reviewed release changes are on `main`, create and push the release
tag:

```bash
git tag -a v0.1.0 -m "Flapstack 0.1.0"
git push origin v0.1.0
```

The workflow publishes `Flapstack-0.1.0-arm64.dmg`,
`Flapstack-0.1.0-x64.dmg`, and `SHA256SUMS.txt`. A repeated tag, a tag not on the
current `main` commit, or a tag whose version does not match `package.json`
fails.

Signing and notarization should return for a later release. That removes the
unidentified-developer warning and gives users Apple's malware-check signal.
