# Flapstack UI Design

This file is the durable, repository-owned visual and interaction authority for
Flapstack. OpenSpec designs may refine a feature, but they must preserve the
product rules below or update this file in the same change.

## Product direction

Flapstack is a local-first workbench for people coordinating projects, Chats,
runs, terminals, files, and multiple agents. The interface should feel like a
quiet instrument panel: dense when the user asks for density, calm by default,
and exact about ownership, authority, freshness, and recovery.

The visual character is **precision workshop**:

- neutral paper/ink surfaces with one electric-blue action signal;
- amber reserved for plans and previews, never generic decoration;
- compact geometry, crisp one-pixel boundaries, and restrained elevation;
- meaningful motion that explains ownership or state changes;
- generous blank space around decisions, dense rhythm inside transcripts,
  tables, trees, diffs, and terminals.

Flapstack does not imitate a chat toy, a social feed, or a generic card
dashboard. Project, Task, Chat, Run, and Workspace remain visible first-class
objects.

## Hierarchy and navigation

1. The sidebar answers **where am I?**: project, task, Chat, archive, or global
   scope.
2. The workbench header answers **what owns this view?** and exposes only the
   primary object, durable status, and one level of navigation.
3. The composer answers **what will launch?**: exact Agent Profile, provider,
   model, Runtime, permissions, worktree, effort, and speed preference.
4. Details and overflow surfaces answer **what else is true?**: provenance,
   diagnostics, usage, activity, files, and recovery.

Do not duplicate the same launch or lifecycle control in header, transcript,
and details. Keep one authoritative action and route secondary entry points to
it. Never reintroduce nested Chats; lineage is navigation among durable
top-level Chats.

Every destination must be reachable through both keyboard navigation and
search. Selection, active execution, unread attention, stale data, and window
ownership are distinct states and must not share one ambiguous highlight.

## Type

- UI and prose: bundled `Geist Sans`, followed by native platform sans fallbacks.
- Code, paths, identifiers, usage figures, and timestamps: bundled
  `Geist Mono`, followed by native monospace fallbacks.
- Do not fetch fonts at runtime.
- Base UI size is 14 px. Supporting text may use 12–13 px; interactive text
  never drops below 12 px.
- Page title: 20 px/600. Section title: 15 px/600. Control label: 13 px/500.
- Use tabular numerals for time, cost, token, progress, and benchmark values.

Text hierarchy must survive 200% zoom without clipping, overlap, hidden
actions, or horizontal page scrolling. Terminal, diff, graph, and timeline
can retain their own bounded scroll regions.

## Color and elevation

The canonical accent is electric blue `#0034ff` in both themes. It marks
primary action, focus, active navigation, and selected graph nodes. It is not a
background wash.

Semantic color is always paired with text, icon, or pattern:

- green: completed or healthy;
- amber: plan, preview, warning, or attention;
- red: destructive, failed, or unsafe;
- violet: optional usage/insight dimension, never primary action;
- gray: inactive, unavailable, stale, or supporting state.

Light theme uses white work surfaces over a near-white timeline field. Dark
theme uses near-black work surfaces with a warm charcoal input/timeline field.
Cards are reserved for independently actionable units, not every section.
Prefer boundaries and spacing to stacked shadows. Menus, dialogs, and floating
transfers may use one restrained elevation layer.

All tokens live in the renderer theme variables. Feature code must not invent
provider-specific palettes or hard-code theme-dependent foreground/background
pairs.

## Spacing, density, and shape

- Spacing unit: 4 px.
- Control heights: 28 px compact, 32 px default, 40 px touch.
- Default content gap: 12 px. Section gap: 20–24 px.
- Corner radius: 8 px default; 6 px compact; fully round only for status dots,
  avatars, segmented markers, and the progress capsule.
- Default transcript measure: 72–88 characters for prose, while code/diffs
  retain horizontal space.

Density is a presentation preference. Compact mode may reduce spacing and
control height but may not remove names, status, authority, focus, or recovery.
Responsive collapse must preserve data and offer an explicit path back to a
hidden pane.

## Shared interaction primitives

All primary surfaces reuse one family of:

- button, icon button, field, select, checkbox, switch, segmented control;
- tab strip, tree row, breadcrumb, chip, status marker, progress capsule;
- popover, tooltip, menu, dialog, alert dialog, side sheet;
- empty, loading, unavailable, stale, error, partial-success, and recovery
  states.

Every interactive primitive has hover, active, focus-visible, disabled, busy,
and error behavior. Focus uses the brand-blue ring with sufficient offset; it
never relies on browser default suppression without a replacement.

Icon-only actions require accessible names and tooltips. Destructive actions
name the exact target and effect. Partial results list successes and failures
instead of collapsing to a generic toast.

## Chat, run, and transcript

The Chat pane is the reusable full interaction unit. Each visible Chat owns:

- one heading and durable Chat identity;
- transcript scrollbar and keyboard-scroll target;
- timeline/minimap;
- composer draft and focus;
- run, stream, question, approval, error, and recovery state;
- exact editable-window ownership.

Tool, reasoning, change, question, approval, and system rows use consistent
structure: identity, status, concise summary, optional detail, and relevant
action. Private or unavailable reasoning is never represented as empty content.

The progress capsule shows only known values. Missing totals stay absent rather
than becoming zero. The timeline groups long history, previews the selected
event, supports keyboard/touch navigation, and keeps full detail one action
away.

## Settings and feature visibility

Top-level Settings categories are sorted alphabetically by their displayed
English label after fixed navigation utilities such as search/back. Provider
subsections may use a deterministic provider order documented in their
registry.

Every eligible control has:

- a stable setting ID;
- category, label, description, and search keywords;
- a direct route and focus target;
- dirty, saving, saved, conflict, error, and unavailable states.

Feature visibility changes navigation and presentation only. Hidden features
retain data, allowed API/MCP behavior, safety, audit, background operation, a
searchable Settings entry, and an explicit re-enable route. Setup presets show
an exact diff before mutation.

## Workspaces, panes, and windows

One, two, three, or four visible Chat panes remain fully interactive. Other
pane types may share the same group tree but must retain exact object identity
and provenance. Split handles expose keyboard equivalents and current size.

The application allows the main workbench plus at most three auxiliary
workbench windows. Dialogs are not workbench windows. Creation reservations are
atomic; a rejected fifth window preserves source state and offers an existing
destination.

Only one window owns editable control of a Chat at a time. Transfer is atomic:
the source remains owner until the destination acknowledges durable ownership.
Failed transfer, crash, stale restore, or over-limit saved state must preserve
the Chat and draft. Excess saved windows remain dormant and recoverable.

## Knowledge graph

Markdown files are the source of truth. Graph/search state is rebuildable.
Backlinks and graph views complement the accessible note tree and list; they
never become the only navigation.

Nodes show stable identity, title, type, unresolved/ambiguous status, and
selection. Edge direction and link type are distinguishable without color.
Canvas controls have keyboard equivalents, a readable list projection, zoom
reset, fit selection, filters, and reduced-motion behavior.

## Motion

Use motion to explain:

- pane insertion/removal and window ownership transfer;
- progress advancing;
- focus moving to a deep-linked control;
- graph selection/expansion;
- stale content becoming current.

Prefer 120–180 ms ease-out transitions. Avoid perpetual ambient animation.
Streaming indicators and spinners stop when work stops. Under reduced motion,
replace spatial travel with immediate state change or opacity no longer than
80 ms.

## Accessibility and input

Primary flows must work with keyboard alone, touch where supported, and the
platform screen reader. Required baseline:

- WCAG AA contrast;
- logical headings and landmarks;
- visible focus and no keyboard traps;
- dialogs restore focus;
- live regions announce bounded status changes, not streaming token floods;
- drag/drop has complete keyboard alternatives and previews;
- 200% zoom and 320 CSS-pixel responsive width preserve actions;
- errors state cause, affected object, retained data, and next action.

Speech vocabulary is bounded, inspectable, and drawn only from selected
project/task/Chat context. It never auto-submits text and never sends
unselected private terms to a cloud provider. The transcript remains editable
before submission.

## Content and recovery language

Use concrete object names and verbs: “Move Chat to window,” “Retry run,”
“Rebuild graph index.” Avoid “Something went wrong,” “magic,” or provider
jargon without a repair action.

Unavailable capability copy distinguishes:

1. unsupported by this provider/platform;
2. supported but not configured;
3. temporarily unavailable;
4. denied by authority;
5. stale or uncertain after recovery.

Never claim delivery, persistence, cancellation, approval, or completion before
the authoritative service confirms it.

## Verification fixtures

Stable visual/accessibility fixtures cover:

- light/dark, compact/default, 100%/200% zoom, reduced motion;
- empty/loading/stale/error/recovery/partial-success states;
- fresh user, upgraded user, hidden-feature user;
- 1/2/3/4 Chat panes and rejected fifth pane/window;
- 10k-message Chat, output flood, long paths, Unicode, and missing targets;
- keyboard focus order, screen-reader names, and responsive widths;
- normalized provider content without live secrets or unstable timestamps.

Acceptance compares behavior and hierarchy, not incidental anti-aliasing.
Provider, device, assistive-technology, and package evidence remain separately
identified when the required environment is unavailable.
