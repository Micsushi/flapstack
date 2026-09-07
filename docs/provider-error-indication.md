# Provider error indication

Claude SDK errors, Claude stream failures, and run error presentation share
explicit rate-limit and quota matching. Incidental words such as "generate" and
unrelated numeric identifiers must not be classified as usage limits.

An explicit quota error is shown as "Usage limit reached". A generic rate-limit
error or HTTP 429 is shown as "Provider rate limit", without assuming a reset
time or exhausted subscription allowance. The original error remains available.
This follows the [Claude API error contract](https://platform.claude.com/docs/en/api/errors),
where 429 can cover rate or spending limits. No automatic retry or account switch
is introduced by presentation logic.

Local executable permission failures retain their platform-specific diagnostic.
Unknown provider failures remain visible instead of being converted to quota
errors. This is error presentation, not an account-aware quota polling system.
