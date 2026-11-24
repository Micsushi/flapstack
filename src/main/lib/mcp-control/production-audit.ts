import { getDatabase } from "../db"
import { appendMcpAuditRecord, findUnresolvedMcpDispatch } from "./audit-storage"
import type { McpAuditWriter } from "./registry"

export function productMcpAudit(onChange: () => void): McpAuditWriter {
  return {
    append(record) {
      appendMcpAuditRecord(getDatabase(), record)
      onChange()
    },
    findUnresolvedDispatch(lookup) {
      return findUnresolvedMcpDispatch(getDatabase(), lookup)
    },
  }
}
