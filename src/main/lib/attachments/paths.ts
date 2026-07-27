import { join } from "node:path"

export function attachmentRootForUserData(userDataPath: string): string {
  return join(userDataPath, "attachments")
}

export function attachmentRelativeStoragePath(attachmentId: string, name: string): string {
  return join(attachmentId, name)
}
