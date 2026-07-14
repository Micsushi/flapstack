## ADDED Requirements

### Requirement: Live Settings Search

The system SHALL provide local Settings search that evaluates every typed
character against visible setting labels, descriptions, and curated keywords,
and SHALL navigate a chosen result to its owning tab and control.

#### Scenario: Match from the first character

- **WHEN** the user types the first character into Settings search
- **THEN** matching visible results update immediately without a submit action,
  debounce, minimum query length, or network request

#### Scenario: Match labels descriptions and keywords

- **WHEN** every normalized query token occurs in a setting label,
  description, or keyword alias
- **THEN** that setting appears in results regardless of case, accents, or
  punctuation differences

#### Scenario: Rank stronger matches first

- **WHEN** several settings match the same query
- **THEN** exact label or alias matches rank before label prefixes, keyword
  prefixes, and description-only substrings with deterministic tie ordering

#### Scenario: Open a matched control

- **WHEN** the user activates a Settings search result
- **THEN** Settings opens the owning tab, scrolls the stable target into view,
  focuses it when possible, and briefly highlights it

#### Scenario: Search permission concepts

- **WHEN** the query is `permission`, `access`, `approval`, `read only`, `all
chats`, or `default`
- **THEN** the relevant Permissions settings appear even when the query matches
  a curated keyword rather than the visible label

#### Scenario: Hidden setting stays hidden

- **WHEN** a development-only Settings control is not visible in the current
  build
- **THEN** it is not returned by Settings search

#### Scenario: Keyboard search navigation

- **WHEN** Settings is open
- **THEN** `Cmd/Ctrl+F` focuses search, arrow keys and Enter navigate results,
  and Escape clears a non-empty query before closing Settings
