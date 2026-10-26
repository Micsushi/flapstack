# Flapstack on your phone

The mobile web app connects to Flapstack running on your computer. It can start
Codex or Claude chats inside a project you allow, continue existing conversations,
show responses as they arrive, and answer agent questions. A message sent while
the agent is working waits for that turn to finish. The computer must remain
awake, connected, and running Flapstack.

## Connect

1. Connect both devices to your private network or Tailscale.
2. In desktop Settings, open Mobile Companion. Enable the bridge on the
   computer's private or Tailscale address, then create a pairing QR code.
3. Open the link on your phone. Compare the certificate fingerprint with the
   desktop before trusting the connection and pairing the device.
4. On the desktop, grant the paired phone access to the project with **Allow
   chats and controls**. The phone connects automatically when access is granted;
   choose an access scope if you have more than one. Existing grants retain their
   original capabilities; create a new
   project grant to enable starting chats.
5. Choose **New chat**, select the project and agent, and send a message.
   Existing chats appear in the conversation list. The same messages are stored
   in the desktop conversation.

Use the connection button at the top to change connection settings. Activity
and approvals are available below the composer. Privileged actions keep their
existing desktop step-up requirements. Provider availability, project permissions,
and usage limits still apply on the computer.

## Reconnect and drafts

The browser retains its pairing key on that device and authenticates again after
a disconnect or application restart. A revoked grant or device needs desktop
attention. Offline controls cannot send messages. Drafts stay in the current
browser tab's session storage across reloads and reconnects; closing the tab may
remove them. If a paged snapshot is interrupted, the browser reconnects and
continues recovery instead of treating the temporary page failure as an access
change. Unconfirmed sends are never automatically replayed. Check the
conversation before retrying if delivery could not be confirmed.

The app shell can be added to the phone's home screen. Notifications are best
effort while connected, not a background push service. Conversation text is
redacted for common credential patterns; private provider metadata and reasoning
are excluded from the mobile transcript.

## Sandbox and installed version

Use a separately named development profile for phone testing. Its bridge
settings, pairing keys, grants, chats, and TLS certificate belong to that profile.
Do not copy the installed version's database or certificate keys into a test
profile. A new Sandbox certificate must be verified separately on the phone.
An expired certificate is renewed by the bridge; verify its new fingerprint.

Automated checks use isolated databases and offscreen browser fixtures. They do
not establish that a physical phone can reach the current host. Release checking
must include a real phone: new chat, streamed response, follow-up, agent question,
background/reopen, reconnect without pairing again, and visibility of those same
messages on the computer.

## Control receipts and navigation

Steering, answers and run controls wait for a matching host receipt. A rejected
command keeps its draft for an explicit retry. A disconnect or missing receipt
means delivery is unknown: check the host before retrying because the action
may already have run. The companion never replays these controls automatically.
Receipt state is retained in this browser tab; clearing its session storage
removes that local evidence.

A late send result or reconnect does not replace a chat you opened meanwhile.
If access removes the selected chat, the companion returns to the conversation
list and retains its text draft in this tab. Pairing requires fingerprint
confirmation, and expired desktop QR codes are hidden until you create a fresh
offer. A QR encoding failure can be retried without creating another offer.
