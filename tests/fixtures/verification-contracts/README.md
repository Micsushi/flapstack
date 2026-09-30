# Frozen release verification contracts

These are derived test inputs, not editable plans or current acceptance records.
Historical checkmarks and release holds describe the pinned source snapshot only.
Project Records owns current Flapstack planning, task progress and acceptance.
Public CI needs neither that private service nor the original planning directory.

The Stage 3, Stage 6 and usage validators consume this directory. The development
`openspec_validate` operation validates the complete Stage 1 change here; its
legacy status field points to the retained MCP change fixture. Generic user-project
OpenSpec discovery and promotion continue unchanged.

`provenance.json` records the exact source commit, paths and original byte hashes,
plus normalized fixture hashes and transformations. LF normalization makes hashes
portable across Git checkouts. Private home prefixes were replaced with
`/example-home`; no provider credentials or private service settings belong here.
The Stage 1 and MCP archived changes are exposed under active change names only
inside this isolated verification fixture.

Do not update these files as tasks complete or regenerate automatically from
mutable plans. An intentional contract revision must update the owning validation
checks, review the required source/evidence coverage and sanitization, and record
new provenance together. Preserve negative tests and release/capability holds.
Historical document links are provenance text, not live navigation guarantees.
Original planning sources are preserved in Project Records following verified
import and recovery; these frozen inputs remain independently usable.
