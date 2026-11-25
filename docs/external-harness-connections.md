# External harness connections

In the running Flapstack profile you want to control, open the Flapstack application menu and choose **External Harness Connections**. The shortcut is Ctrl+Alt+Shift+M on Windows and Linux or Command+Option+Shift+M on macOS.

1. Select Codex, Claude Code, or Antigravity. Choose **Read only** for inspection, **Ask before edits** to approve changes in Flapstack, or **Full access** to allow changes and launches across all projects in this profile.
2. Choose a private folder outside your workspaces. Flapstack creates a fresh client configuration there and shows its location and connection ID. It stores the private key in the Flapstack profile’s `data/external-mcp-owner` directory, readable by your OS account. The generated configuration contains the path to that key.
3. Start the external client using the settings below. Ask it to call `ping` on `flapstack-app-control`. The result includes the connection's `external-owner:` identifier and permission mode. Leave Flapstack running for live UI updates and run pickup.

| Client      | How to use the generated configuration                                                                                                                                                                                                                                                                                       |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex       | Copy the generated `[mcp_servers.flapstack-app-control]` and its `.env` table into your regular `%USERPROFILE%\.codex\config.toml` on Windows or `~/.codex/config.toml` on macOS/Linux. If you already use `CODEX_HOME`, edit its `config.toml`. Replace an older entry for the same server, then start a new Codex session. |
| Claude Code | Run `claude --strict-mcp-config --mcp-config "<generated directory>/mcp.json"`.                                                                                                                                                                                                                                              |
| Antigravity | Change the working directory to the generated directory and start `agy`. Its workspace configuration is in `.agents/mcp_config.json`.                                                                                                                                                                                        |

In a noninteractive Codex session, select the individual actions the client may invoke without a prompt. For example, this entry in the generated `config.toml` allows Codex to request project creation. Flapstack checks its own connection grant on every call. [Codex configuration reference](https://developers.openai.com/codex/config-reference/)

```toml
[mcp_servers.flapstack-app-control.tools.create_project]
approval_mode = "approve"
```

Antigravity prompts before using a newly connected MCP tool. For a headless connection check, pass `--settings` with `{"permissions":{"allow":["mcp(flapstack-app-control/ping)","mcp(flapstack-app-control/describe)"]}}`. This allows those two read-only calls for that session. [Antigravity CLI permissions](https://antigravity.google/docs/cli-permissions)

On Windows launcher-managed Preview installations, the registration uses Windows PowerShell as a stable stdio shim. Each connection reads the selected executable from `%LOCALAPPDATA%\Programs\FlapstackPreview\Launcher\launch-config.json` and starts that executable’s bundled `mcp-control-stdio.js`. Deployments that change the executable path can use the same grant as long as they keep the same profile. For other installations, the registration uses the current executable directly. Replace any pre-existing registration that points into a versioned install folder by issuing a new connection from the updated desktop.

For a manual standard-profile connection, the server also accepts `--external --profile <absolute user-data directory>` with an owner-issued credential and derives `data/agents.db`. The desktop grant determines the permission mode.

To revoke access, reopen **External Harness Connections**, select **Revoke a connection**, and select the grant with the matching connection ID. The next tool call from that client will fail, including on an existing connection. Remove its server table from your regular Codex configuration or remove the generated client directory. Register again to issue a fresh credential.

Agents launched inside Flapstack receive a separate credential scoped to their chat and active run. The running desktop verifies it at startup and on every tool call, including reads. Flapstack disables owner MCP registrations for child runs and strips owner credential environment variables. The OS account is the security boundary for the private key file. Run software that needs separation from your own files under a different OS account.

Flapstack shows a short initial tool list to agents it launches. Call \`tool_search\` with a tool name or purpose to load matching tools for that connection. Refresh the client's tool list to retrieve their schemas. If a client cannot refresh its tools, launch the MCP server with \`--tool-exposure direct\` or set \`FLAPSTACK_MCP_TOOL_EXPOSURE=direct\` in its MCP registration. External clients list their tools directly by default and can opt into discovery with \`--tool-exposure lazy\`.

When Flapstack is open, the stdio launcher relays requests to the selected profile's authenticated loopback HTTP server. With the app closed, a verified external owner can still use offline database tools. App-launched agents require an active desktop and a valid run registration.

Conversation, run activity, search, and diff responses are limited to 64 KiB. Follow \`nextCursor\` for conversation, run activity, and search pages. For a diff, pass \`nextOffset\` and the returned \`diffHash\` to continue the same snapshot. If a diff takes longer than the initial response window, use \`dispatch_status\` to collect its result using the supplied handle.
