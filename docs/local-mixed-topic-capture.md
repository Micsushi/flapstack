# Local mixed-topic capture

A capture keeps the exact original message before local processing begins. Grouping assigns immutable source spans to topics. Canonical association then compares those groups with retrieved project records. Finally, semantic review checks a projected set of topics in which an update replaces its existing topic exactly once. Previous summaries remain available as evidence for preserving confirmed constraints.

Canonical comparison is partial: retrieval selects at most six relevant feature records and three existing local topics. Candidate presence and shared words do not establish a match. The association stage receives each selected record's full description within the context limit; oversized descriptions make canonical comparison unavailable. Empty associations do not prove that no duplicate exists elsewhere.

The entire capture has a hard limit of four local model calls, with a 45-second limit per call. Grouping, association, and review normally use three calls. A correction is attempted only when all remaining required stages fit the same four-call budget. Exact span coverage, record IDs, source identity, and revision conflicts are checked in code. No automatic canonical writes or task launches occur.

If generation, validation, context limits, or concurrent edits prevent completion, the original remains unsorted and available. Accepted groups are saved atomically and share the existing undo/redo flow. This pipeline does not establish implementation completion or owner acceptance.
