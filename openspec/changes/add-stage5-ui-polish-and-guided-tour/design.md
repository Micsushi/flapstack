## Context

The defects were observed on native Windows after Stage 5 implementation. Most
visual geometry is shared with macOS, so fixes must use shared component rules
instead of operating-system-specific pixel offsets. Stage 6 contains a separate
feature-visibility questionnaire; that is not the same thing as a tour of the
existing main page.

## Goals / Non-Goals

- Goals: restrained navigation motion, coherent header/sidebar geometry,
  platform-truthful launch actions, reliable notification routing, current
  new-chat defaults, and short first-use guidance.
- Non-goals: changing provider reasoning/skills/tool behavior, importing the
  Stage 6 visibility subsystem, redesigning all Stage 6 surfaces, or silently
  changing models on existing chats.

## Decisions

- Shared CSS owns alignment and spacing. Platform branches own only native
  chrome, labels, executable discovery, and shortcuts.
- Existing chat titles render immediately. A typewriter effect may run only
  once when a new generated title first arrives.
- Planning phrases use a stable run-keyed sequence and rotate no faster than
  four seconds. Reduced motion freezes the phrase.
- The sidebar default becomes 272 px with a 360 px maximum. Only the untouched
  legacy 224 px default migrates.
- Chat modes are Write, Plan, and Review. Legacy Read normalizes to Review.
  Plan and Review remain read-only through permission resolution.
- Open In options come from a typed main-process availability query. The native
  folder action always exists; optional apps appear only when platform-valid
  and installed.
- Notification targets are retained in main until the app-scope renderer
  consumes them. Navigation resolves project, chat, and compatibility subchat
  state in that order.
- `claude-opus-5` and `gpt-5.6-sol` become new-chat defaults. Explicit stored
  `claude-opus-4-8` and `gpt-5.5` values remain valid.
- Product-tour state is versioned and local. Normal packaged profiles auto-run
  an incomplete version once. Development and test profiles never auto-run it.
  Settings can start it manually in every profile.
- The tour has at most eight steps. Each step has one short title and no more
  than two short sentences.

## Risks / Trade-offs

- Application detection differs by platform. Keep detection conservative and
  fall back to the native folder action.
- Notification clicks can race renderer hydration. Use consume-once pending
  state rather than timing delays.
- DOM anchors can disappear at narrow widths. Each tour step must skip a
  missing anchor safely and retain keyboard focus.
- Model availability can differ by account. Keep older IDs selectable and
  surface provider errors without mutating the catalog at runtime.

## Migration Plan

- Migrate only legacy Read mode to Review and only the untouched 224 px sidebar
  default to 272 px.
- Do not rewrite stored chat model IDs.
- Add a new versioned product-tour completion key. Existing users are not
  treated as fresh packaged profiles unless the key and profile state indicate
  a genuinely new normal installation.
- Persisted unavailable external-app choices fall back to the native folder
  action.
