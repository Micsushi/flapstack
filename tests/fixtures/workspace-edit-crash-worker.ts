import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import * as schema from "../../src/main/lib/db/schema"
import { WorkspaceEditingService } from "../../src/main/lib/workspace-editing/service"
import {
  removeFileInsideRoot,
  renameFileInsideRoot,
  writeFileInsideRoot,
} from "../../src/main/lib/path-safety"

const database = new Database(process.argv[2])
const service = new WorkspaceEditingService(
  drizzle(database, { schema }),
  async (root, path, source, options) => {
    await writeFileInsideRoot(root, path, source, { ...options, afterCommit: undefined })
    // Terminate the isolated child at the durable-file / unfinished-journal boundary.
    process.exit(73)
  },
  async (root, path, options) => {
    await removeFileInsideRoot(root, path, options)
    process.exit(73)
  },
  async (root, path, name, options) => {
    await renameFileInsideRoot(root, path, name, {
      ...options,
      afterLink:
        process.argv[4] === "rename-linked"
          ? () => {
              process.exit(73)
            }
          : undefined,
    })
    process.exit(73)
  },
)
const input = JSON.parse(process.argv[3])
if (process.argv[4] === "create") await service.saveAs(input)
else if (process.argv[4] === "remove") await service.revert(input)
else if (process.argv[4]?.startsWith("rename")) await service.rename(input)
else await service.save(input)
