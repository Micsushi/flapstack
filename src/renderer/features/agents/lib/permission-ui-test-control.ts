import type { DevRendererControlCommand } from "../../../../shared/dev-renderer-control"

type PermissionUiCommand = Extract<
  DevRendererControlCommand,
  { command: "permissions.ui.get" | "permissions.ui.control" }
>

type PermissionUiHandler = (command: PermissionUiCommand) => unknown | Promise<unknown>

let activeHandler: PermissionUiHandler | null = null

export function registerPermissionUiTestControl(handler: PermissionUiHandler): () => void {
  activeHandler = handler
  return () => {
    if (activeHandler === handler) activeHandler = null
  }
}

export async function invokePermissionUiTestControl(command: PermissionUiCommand) {
  if (!activeHandler) throw new Error("No active chat permission UI is mounted")
  return activeHandler(command)
}
