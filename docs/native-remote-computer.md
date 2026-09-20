# Native remote computer

The desktop app can pair with another Flapstack host on a private network, show
work selected by that host, and answer its agent clarification requests. Open
Settings → Mobile companion → Remote computer on the connecting desktop.

1. On the host, enable the private HTTPS bridge and create a pairing offer.
   Copy its connection link to the other computer before the offer expires.
2. On the connecting desktop, paste the link and enter a computer label. Compare
   its address and certificate fingerprint with the host before pairing.
3. On the host, give the paired device a grant for the intended work. Copy the
   grant ID into the connecting desktop and select Connect.
4. Wait for current host state. Review the exact host, chat and request before
   confirming and sending an answer. A pending delivery is not a completed
   answer; wait for the host receipt.

The signing identity is stored through OS protected storage. Pairing fails if
protected storage is unavailable; there is no plaintext fallback. Certificate
pinning belongs only to this connection and does not change OS trust. Only
explicit private-network HTTPS addresses are accepted, and redirects are rejected.

Disconnect stops the local connection. Reconnect authenticates again and requires
a fresh scoped snapshot. Expired state or revoked access disables answers. If a
connection ends without a receipt, check the host before resubmitting: the client
does not replay uncertain commands. Revoke the device or its grant on the host
to remove its access.

This client currently supports scoped viewing and clarification answers. It does
not expose arbitrary remote commands, new remote chats, or a full remote coding
workspace. Fixture and owned TLS tests cover the protocol boundaries; physical
Mac/Windows pairing, reconnect and revocation still require a two-computer check.
