import { dialog } from "electron"
import { basename, dirname, join } from "node:path"
import { realpathSync, rmSync, unlinkSync } from "node:fs"
import {
  externalGrantDirectory,
  externalGrantPath,
  externalPermissionModes,
} from "./external-grant"
import {
  createExternalMcpRegistration,
  externalClients,
  externalOwnerCredentialPath,
  externalClientNames,
  type WindowsMcpLauncher,
} from "./external-registration"

export async function manageExternalMcpRegistration(
  databasePath: string,
  mainDirectory: string,
  windowsLauncher?: WindowsMcpLauncher,
) {
  const { response } = await dialog.showMessageBox({
    message: "Connect an external harness to this Flapstack profile",
    buttons: [...externalClientNames, "Revoke a connection…", "Cancel"],
    defaultId: 4,
    cancelId: 4,
  })
  if (response === 4) return
  if (response === 3) {
    // A chooser confines revocation to one grant belonging to this profile.
    const grantsDir = externalGrantDirectory(databasePath)
    const selected = await dialog.showOpenDialog({
      title: "Select the connection ID to revoke",
      defaultPath: grantsDir,
      properties: ["openFile"],
      filters: [{ name: "Flapstack grants", extensions: ["json"] }],
    })
    if (selected.canceled) return
    const file = selected.filePaths[0]!
    const grantPath = externalGrantPath(databasePath, basename(file, ".json"))
    if (realpathSync.native(file) !== grantPath)
      throw new Error("Select a grant belonging to this Flapstack profile.")
    const confirm = await dialog.showMessageBox({
      message: "Revoke this external connection?",
      detail: basename(file, ".json"),
      buttons: ["Cancel", "Revoke"],
      defaultId: 0,
      cancelId: 0,
    })
    if (confirm.response === 1) {
      unlinkSync(grantPath)
      rmSync(
        externalOwnerCredentialPath(realpathSync.native(databasePath), basename(file, ".json")),
        { force: true },
      )
    }
    return
  }
  const client = externalClients[response]
  if (!client) return
  const modeChoice = await dialog.showMessageBox({
    message: `Allow ${externalClientNames[response]} to control this Flapstack profile?`,
    detail:
      "This connection can see all projects. Choose whether it can change them and launch runs.",
    buttons: ["Read only", "Ask before edits", "Full access", "Cancel"],
    defaultId: 0,
    cancelId: 3,
  })
  const permissionMode = externalPermissionModes[modeChoice.response]
  if (!permissionMode) return
  const destination = await dialog.showOpenDialog({
    title: "Choose a private folder for the external client configuration",
    properties: ["openDirectory", "createDirectory"],
  })
  if (destination.canceled) return
  const result = createExternalMcpRegistration({
    client,
    permissionMode,
    databasePath,
    configDir: process.env.FLAPSTACK_CONFIG_DIR || dirname(databasePath),
    executablePath: process.execPath,
    entryPoint: join(mainDirectory, "mcp-control-stdio.js"),
    outputRoot: destination.filePaths[0]!,
    windowsLauncher,
  })
  const instruction =
    client === "codex"
      ? "Copy the generated MCP server table into your regular Codex config, then start a new Codex session:"
      : client === "claude"
        ? "Start Claude Code with --strict-mcp-config --mcp-config and this file:"
        : "Start Antigravity in this directory:"
  await dialog.showMessageBox({
    message: `${externalClientNames[response]} connection created`,
    detail: `${instruction}\n${client === "antigravity" ? result.directory : result.configPath}\n\nConnection ID: ${result.grantId}`,
  })
}
