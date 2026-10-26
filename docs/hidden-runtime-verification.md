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

## Windows development evidence, 2026-10-26

An isolated snapshot of the retained `1b98291da472` checkout and its current
changes completed all 46 core development budgets with no omissions or measured
failures. It used Electron 41.10.7 on Windows x64, an i7-12700KF with 64 GiB RAM
and balanced AC power. The report labels its configured budget class
`reference-laptop`; this desktop run does not establish minimum-hardware results.

The acceptance gate correctly rejected the dirty candidate as `untrusted`.
Report SHA-256:
`9e575edaabe5f091d98ed6a70ee36b893c47e3cfab94b20374340afe321ca4bc`.
The snapshot predates the later Topics and MCP settings fixes. These observations
are development evidence, not clean-candidate, packaged-release, visible-window
or owner acceptance. The run used its own dependencies and supervised profiles.

The implementation uses Electron's documented [offscreen rendering](https://www.electronjs.org/docs/latest/tutorial/offscreen-rendering)
and [hidden-window painting behavior](https://www.electronjs.org/docs/latest/api/structures/browser-window-options).

## Electron 43 Windows development qualification, 2026-10-26

The supported Electron 43.8.3 candidate uses Chromium 150.0.7871.250 and Node
24.22.0 internally. The application toolchain remains Node 22.23.3. Its isolated
clean dependency installation, full TypeScript check, build, real Electron
SQLite/PTY ABI 148 loading, shutdown and restoration to Node ABI 127 passed.

The full core performance run observed 45 budgets with no measured failures and
one omitted warm-shell startup measurement. Its status remains `incomplete`;
report SHA-256 is `75b2279dd0f6c74830c2685388aec1e20b147d7ffea99e09ad48e27b61ab09e5`.
A separate exact-process warm-startup run completed one warmup and three measured
samples: 7,215, 6,881 and 9,060 ms, below the 30,000 ms development threshold.
That targeted result does not rewrite the original report or establish why its
first startup attempt failed. Neither run establishes packaged startup budgets.

Eight affected existing test files produced 82 passes, one skip and two stale
packaging failures. Updating the exact dependency-version assertions and removing
an obsolete license override resolved both; all 29 packaging tests then passed.
The new parser package supplies its full upstream license. The dependency audit
has nine entries (two high, four moderate, three low), with no Electron entry;
remaining library advisories require separate assessment.

These measurements used the same Windows desktop described above, a dirty
source candidate and hidden supervised profiles. The snapshot predates the later
workspace and mobile-companion recovery integration. It does not qualify current
combined UI behavior, macOS/Linux native compatibility, signed distribution or
minimum hardware. The retained checkout's installed dependencies and live app
were not changed by integrating the manifests.

The later combined candidate included 124 exact retained-checkout overlays,
including workspace recovery, mobile companion recovery and MCP configuration
undo. Its standard `check` command passed lint, formatting, full TypeScript,
native Node ABI checks, the bounded core performance lane, 4,735 tests with 46
skips, 11 additional Windows product checks, and the production build. This is
combined source/build evidence; the preceding full native performance report
retains its original source identity and limits.

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
provider credentials, signed distribution, or the remaining Stage 7-10 work.

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
The package lifecycle test uses a temporary launch-agent fixture, not a real
persistent service. Native Intel verification remains a separate check.

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

Two real launchd smoke runs passed on the same arm64 Mac using harness
`2155daf2` against the unchanged `d579aff8` package: closed-app launch, poll,
stop, restart and cleanup. The runs used distinct UUID service identities and
left no smoke plist or process. Provider samples and alerts were not enabled;
this evidence does not claim credentialed provider or Discord delivery coverage.

## Windows Electron 43 preview, 2026-10-26

An isolated Windows x64 preview built with Electron 43.8.3. Package inspection,
license/provenance/secret/native-file audit, and bundled Claude/Codex/Whisper/STT
protocol checks passed. SQLite and Sharp executed from the packaged archive;
node-pty loaded with ABI 148. A non-remediating Microsoft Defender scan found
no threats. The unsigned preview policy remains distinct from release signing.

The archive SHA-256 is `0262b2a0a3a3374851288204126724154fcc155ae3b0afa30a15bfc94872b525`.
This snapshot includes terminal stop recovery, usage, inbox and Android browser
repairs. Later voice-generation and repository-onboarding edits postdate it.
No production installation, restart, live provider call or publication occurred.
Native PTY behavior is separately qualified by the Windows fixture described in
[terminal ownership](terminal-session-ownership.md).

The package excludes SQLite rebuild-cache binaries under `better-sqlite3/bin`;
the required `build/Release/better_sqlite3.node` remains and passed its packaged
load check. On this host, STT preparation needed the dependency
crate's TEMP fallback by omitting LOCALAPPDATA only for its build child process.
The normal environment was restored for packaging and cached subsequent builds.

The later 142-file integrated source snapshot passed 4,746 checks with 46 skips,
including lint, formatting, types, the feature ledger and build. A subsequent
preview includes the outer dictation feed guard and current project-name fix.
Its archive SHA-256 is `1622cd528ff08892fe6e0bc79619ade9486fa6eeb47f7de149e672037363c62b`.
In an isolated hidden packaged profile, onboarding persisted across restarts;
project/global chat scope, permission snapshots, rename, pin, archive and restore
passed. The composer now shows the renamed project after restart. The profile
contained three synthetic chats and zero agent runs. Credentials, visibility
recovery and PWA v4 changes made afterward require their own integrated artifact.
The preceding package audit and Defender result retain their earlier archive
identity and are not asserted for this later artifact.

A subsequent 149-file preview has archive SHA-256
`70e2437729ae0cf0cb9cb897a10e32240bfe6b3e1e433c8441e3758936746f00`.
Hidden native Settings checks at 640px and 1280px found no horizontal overflow;
all 20 rendered Appearance and Preferences switches/selects had accessible
names. Leaving Keyboard settings while recording a shortcut now clears recording
state, and the normal Settings shortcut works again outside text entry.
This artifact includes credential recovery and PWA v4, but predates the later
Linux survivor, visibility cache-ordering, automation editor, Portability,
profile editor and archive retry changes. Earlier artifact security results do
not automatically apply to this snapshot.

The next integrated source check passed 4,735 tests plus 11 separate Windows
checks, with 46 skips, and completed lint, formatting, types, ledger, performance
and build gates. Later profile/sidebar recovery edits passed another 59 focused
existing checks and full type checking. These counts describe their source
snapshots rather than every later edit.

Preview archive `66b66d39e545ba4232a8f351913e2aeddb4a1bce296056220d4f909bfed8a7e2`
includes the subsequent Portability, profile draft and archive retry repairs.
Its package provenance, license, secret and native-file audit passed under the
unsigned preview policy. A native hidden-profile check at 640/1024/1280px confirms
Project Settings stacks its project list at narrower widths and keeps the name
field and configuration controls visible and keyboard-reachable. Deliberate
long-path truncation remains; it does not conceal the editable form. This
artifact predates subsequent project save-recovery and profile reversal work.

The same archive passed a non-remediating Defender scan with no threats found.
Its native Profile Studio created one synthetic profile, saved a renamed second
version, archived/restored it, and reopened that version after restart. An unsaved
name also survived opening the nested Personality Library and returning. The
private profile retained zero snapshots and zero standalone launches throughout;
provider execution and the later chronological undo implementation are not
qualified by this check.

The final corrected preview archive is
`8539da93d859b3778634c22b78830d40b6f8d7d91560e81518d1e495a1b7e825`.
Its 161-file overlay includes project save recovery, sidebar selection/rename
recovery and chronological profile/personality reversal. The preceding combined
source check passed 4,746 tests with 46 skips and all lint, formatting, types,
ledger, performance and build gates. The final reversal correction then passed
43 focused existing tests, full type checking and another production package
build. Independent review closed the redo-invalidation, lost-acknowledgment,
refresh-warning and cross-window-notification findings.

A hidden native Windows run on this exact archive saved a synthetic profile,
used keyboard undo and redo, then preserved a newer unsaved draft during toolbar
undo. Immutable versions advanced from the initial v2 through v6. A separate
native IPC check deliberately discarded the first committed undo acknowledgment;
retrying that sequence returned the acknowledgment without changing the record
or version. Redo advanced once, an old sequence was rejected without a write,
and the next undo restored the original values while retaining earlier versions.
Both checks used only the existing disposable profile and recorded zero snapshots
and standalone launches. They qualify profile reversal, not provider execution,
personality native UI, or excluded create/import reversals.

The final archive also passed the unsigned-preview package provenance, license,
secret and native-file audit. A non-remediating Defender scan finished with no
threats found. These checks are not a clean dependency-vulnerability report or
a release-signing qualification; the known Zod 3 advisory remains open.
