## 1. Implementation

- [x] 1.1 Add shared local date/time formatting.
- [x] 1.2 Persist or recover timestamps during message synchronization.
- [x] 1.3 Show timestamps beneath user and assistant messages.

## 2. Verification

- [x] 2.1 Add focused timestamp formatting tests.
- [ ] 2.2 Manually verify today and older transcript messages.

2026-07-13 lane attempt: a disposable fixture included both today and older
message timestamps and the isolated `ee39-ux` Dev profile passed
`npm run dev:verify`, but locked macOS prevented visual inspection. Task 2.2
remains open.
