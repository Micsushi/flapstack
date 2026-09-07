import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import * as schema from "../../src/main/lib/db/schema"
import { WorkspaceEditingService } from "../../src/main/lib/workspace-editing/service"
import { writeFileInsideRoot } from "../../src/main/lib/path-safety"

const database = new Database(process.argv[2])
const service = new WorkspaceEditingService(
  drizzle(database, { schema }),
  async (root, path, source, options) => {
    await writeFileInsideRoot(root, path, source, { ...options, afterCommit: undefined })
    // Terminate the isolated child at the durable-file / unfinished-journal boundary.
    process.exit(73)
  },
)
await service.save(JSON.parse(process.argv[3]))
