## 1. Implementation

- [x] 1.1 Add the shared `OpenInButton` to the desktop conversation header.
- [x] 1.2 Pass the active chat's resolved local folder to the control without provider-specific branching.
- [x] 1.3 Preserve disabled behavior when no local folder is available.

## 2. Verification

- [x] 2.1 Add focused automated coverage for the header control and folder target.
- [x] 2.2 Run formatting, lint, strict TypeScript, and focused tests.
- [x] 2.3 Run `npm run dev:verify` and manually confirm the current folder opens from a local chat.
