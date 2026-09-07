# Local chat title generation

Automatic titles use the existing local Ollama metadata pipeline when enabled.
They do not consume the active chat provider's quota. The configured title style,
model choice, structured metadata validation, and fallback remain unchanged.

Ollama discovery is bounded to two seconds and 2 MiB. Title generation is bounded
to 30 seconds and 256 KiB. Both limits include reading the response body, not just
receiving headers. Requests stay on the fixed localhost endpoint and do not follow
redirects. Malformed discovery, invalid metadata, network failure, or timeout
returns control to the existing fallback. Response contents are not logged.

The deterministic tests cover stalls before and after headers, size limits,
cancellation, model selection, schema rejection, and fallback eligibility. They
do not measure title quality from an installed model or replace the existing
heuristic fallback with semantic generation.

Automatic application uses a separate atomic mutation. Only empty names or the
default `New Chat` placeholder are eligible. A late result leaves existing names
alone; only the first sub-chat may also name an untitled parent. Cache updates
follow the mutation's per-row result. Manual rename and undo behavior is unchanged.
New chats use the placeholder while generated titles are enabled; disabling the
setting retains the previous first-message preview. Existing non-placeholder names
are preserved even when their historical origin cannot be determined.
An intentional manual name of exactly `New Chat` is indistinguishable from the
placeholder and remains eligible. Durable title-origin tracking is not implemented.
