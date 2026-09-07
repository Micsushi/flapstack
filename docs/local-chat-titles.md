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
do not measure title quality from an installed model. This change does not fix
delayed automatic renames overwriting a manual rename, nor replace the existing
heuristic fallback with semantic generation. Those remain separate work.
