# Hidden runtime verification

The Stage 6 runtime verifier accepts `FLAPSTACK_STAGE6_HEADLESS=1` for an offscreen
window. It requires the verifier's unique supervised profile and run token; an
invalid hidden launch fails rather than opening an ordinary window. Packaged
applications cannot enable this mode. Normal app launches are unchanged.

Performance profiles do not register OS protocol handlers, migrate global Claude
MCP credential files, warm global MCP configuration, or run provider usage catch-up.
Hidden startup failures exit without a native error dialog. The hidden window does not
show or focus on navigation. Its evidence explicitly records `hidden-window`;
this is not proof of native desktop interaction or visible-window performance.
It does not bypass Chromium sandbox requirements.

The implementation uses Electron's documented [offscreen rendering](https://www.electronjs.org/docs/latest/tutorial/offscreen-rendering)
and [hidden-window painting behavior](https://www.electronjs.org/docs/latest/api/structures/browser-window-options).

## Apple Silicon evidence

The isolated macOS 26.5.2 arm64 pass at
`d579aff8c1155468820c94721933f1d168dcb864` used Node 22.23.1 and Electron 39.8.10.
Startup, long-Chat rendering, search, and four-pane input completed through the
real hidden renderer. Single observed samples were 7,543 ms, 269 ms, 306 ms, and
147 ms respectively; they are smoke evidence, not percentile budget acceptance.
The report's integrity SHA-256 is
`726d342143de30c4ff6632c67ca1317ca1378090e17f62e6adc1ee4725312253`.

The verifier removed its four temporary profiles and owned processes and restored
the checkout's Node ABI. Claude configuration, LaunchServices handler settings,
and the separate main checkout's dirty-state fingerprints were unchanged.
The preceding full Mac gate at `bae73eee` passed 4,077 tests with 26 skips,
lint/style/types and build; the changed text-preview tests passed at `d579aff8`.
This does not certify visible desktop interaction, Intel hardware, external
provider credentials, signed distribution, or the remaining Stage 7–10 work.

The same `d579aff8` source produced an unsigned arm64 Preview. Binary inspection,
bundled Claude/Codex/Whisper/STT checks, Electron-hosted SQLite/Sharp/PTY execution,
temporary-directory install/upgrade/rollback/uninstall, and package security
audit passed. No Applications installation or release publication occurred.
The audit accepted only the explicit unsigned/ad-hoc beta policy: signature
metadata was ad-hoc and signature verification failed. This is not a verified
Developer ID signature or notarized distribution.
The package `app.asar` SHA-256 is
`225ccbf8fbf3d21e30dac665f2dbc01dec30ef1f5a1b0d837aa2c9e82524c4db`;
the package security report SHA-256 is
`8d2e05ad8fa6008300e00a1e88328cc6f654a0927d2b12c1391ed61d54d04eb5`.
The lifecycle test uses a temporary launch-agent fixture, not a real persistent
service. Packaged usage-daemon operation and native Intel verification remain
separate checks.

## Packaged usage-daemon smoke isolation

The Mac packaged daemon smoke gives each invocation a UUID-bearing profile
basename, because launchd service identity comes from that basename, not the
temporary parent directory. It refuses an existing plist or loaded service before
installation, including dangling plist symlinks. Failed service inspection is
not treated as absence. The ordinary smoke leaves provider polling and alerts
disabled; credentialed provider checks remain explicit options.

Cleanup only uninstalls a service whose installation this invocation attempted.
If service cleanup fails, the smoke fails and retains its temporary recovery
directory rather than deleting files still referenced by launchd. Stop that exact
reported service before removing its recovery directory. Failure diagnostics
report launchd availability without dumping its environment.
