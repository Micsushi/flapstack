import { getDatabase } from "../db"
import {
  appendMcpAuditRecord,
  findUnresolvedMcpDispatch,
  recoverMcpDispatchClaims,
} from "./audit-storage"
import type { McpAuditWriter } from "./registry"

export function productMcpAudit(onChange: () => void): McpAuditWriter {
  return {
    append(record) {
      appendMcpAuditRecord(getDatabase(), record)
      onChange()
    },
    findUnresolvedDispatch(lookup) {
      recoverMcpDispatchClaims(getDatabase(), { staleAfterMs: 0, limit: 25 })
      return findUnresolvedMcpDispatch(getDatabase(), lookup)
    },
  }
}
