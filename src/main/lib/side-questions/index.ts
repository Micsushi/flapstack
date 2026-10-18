import { AgentProfileChatBindingService } from "../agent-profiles/chat-binding"
import { getCredentialService } from "../credential-service"
import { getDatabase, getSqliteDatabase } from "../db"
import { acquireConfiguredAppDatabaseOperation } from "../db/access"
import { SideQuestionService } from "./service"
import { generateSideAnswer } from "./provider"

const services = new WeakMap<ReturnType<typeof getSqliteDatabase>, SideQuestionService>()
export function getSideQuestionService() {
  const db = getSqliteDatabase()
  let service = services.get(db)
  if (!service) {
    service = new SideQuestionService(
      db,
      generateSideAnswer,
      acquireConfiguredAppDatabaseOperation,
      (chatId, sourceHarness) => {
        const profile = new AgentProfileChatBindingService(getDatabase()).get(chatId)
        if (profile && !profile.available)
          throw new Error(profile.invalidReason ?? "The selected profile is unavailable.")
        const harness = profile?.snapshot.capability.harness ?? sourceHarness
        const custom =
          harness === "claude-code" || harness === "claude" || !harness
            ? getCredentialService().status("claude.custom-api-token")
            : null
        return {
          harness: harness ?? undefined,
          model:
            profile?.snapshot.capability.modelPreference ??
            (custom?.configured && custom.metadata?.model && custom.metadata.baseUrl
              ? custom.metadata.model
              : undefined),
        }
      },
    )
    services.set(db, service)
  }
  return service
}
