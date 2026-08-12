import type Database from "better-sqlite3"
import {
  isAgentChatLabelKey,
  type AgentChatLabelKey,
  type AutomaticChatTagCandidate,
} from "../../shared/chat-metadata"
import { nowEpochSeconds } from "./db/timestamps"

export type ChatAgentLabel = {
  chatId: string
  key: AgentChatLabelKey
  confidence: number
  createdAt: number
  updatedAt: number
}

export function applyAutomaticAgentChatLabels(
  database: Database.Database,
  input: {
    chatId: string
    candidates: AutomaticChatTagCandidate[]
    minimumConfidence: number
  },
): ChatAgentLabel[] {
  const now = nowEpochSeconds()
  const upsert = database.prepare(
    `INSERT INTO chat_agent_labels (chat_id, key, confidence, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(chat_id, key) DO UPDATE SET
       confidence = MAX(chat_agent_labels.confidence, excluded.confidence),
       updated_at = excluded.updated_at`,
  )

  for (const candidate of input.candidates) {
    if (candidate.confidence < input.minimumConfidence || !isAgentChatLabelKey(candidate.key)) {
      continue
    }
    upsert.run(input.chatId, candidate.key, Math.round(candidate.confidence * 100), now, now)
  }

  return listAgentChatLabels(database, input.chatId)
}

export function listAgentChatLabels(
  database: Database.Database,
  chatId?: string,
): ChatAgentLabel[] {
  const rows = (
    chatId
      ? database
          .prepare(
            `SELECT chat_id, key, confidence, created_at, updated_at
           FROM chat_agent_labels WHERE chat_id = ? ORDER BY confidence DESC, key`,
          )
          .all(chatId)
      : database
          .prepare(
            `SELECT chat_id, key, confidence, created_at, updated_at
           FROM chat_agent_labels ORDER BY chat_id, confidence DESC, key`,
          )
          .all()
  ) as Array<Record<string, unknown>>

  return rows.flatMap((row) => {
    const key = String(row.key)
    if (!isAgentChatLabelKey(key)) return []
    return [
      {
        chatId: String(row.chat_id),
        key,
        confidence: Number(row.confidence) / 100,
        createdAt: Number(row.created_at),
        updatedAt: Number(row.updated_at),
      },
    ]
  })
}
