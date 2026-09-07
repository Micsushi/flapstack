# Provider account provenance

New run records include the selected account identifier, authentication mode,
runtime target, and credential revision. These fields contain metadata only;
credential ciphertext and plaintext remain in the main-process credential stores.
The Anthropic account router no longer exposes `getActiveToken` to renderers.
The Claude Code router also removes `getToken` and `getSystemToken`; status and
system-token import remain main-process operations.

Migration 0059 adds these fields without replacing existing run or account rows.
Historical runs receive `legacy-system-default` and `legacy` markers. Those markers
mean the original account cannot be reconstructed reliably, not that a current
account was used. Existing Anthropic accounts retain their ciphertext and receive
subscription/local defaults and revision 1.

Direct, interactive, orchestration, automation, and named-agent launch paths save
the metadata with the run. Loading a queued run reads its saved account metadata;
changing the active account does not rewrite historical runs. Legacy databases
without the new columns remain readable through the reconciliation projection.

This is provenance, not account isolation. Per-account provider homes, credential
rotation enforcement, and binding a running provider session to an isolated home
remain separate S7 work. Do not infer those guarantees from a run's account label.

Verification: `tests/provider-account-provenance.test.ts` covers additive migration,
credential preservation, legacy interpretation, invalid metadata rejection, and
the removed token RPC. Runtime run-creation and migration tests cover persistence.
