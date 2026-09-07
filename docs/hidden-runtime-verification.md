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
