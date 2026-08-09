import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

function read(path: string): string {
  return readFileSync(resolve(path), "utf8")
}

describe("chat tag icons and responsive metadata", () => {
  it("persists optional tag icons and backfills the starter tags", () => {
    const journal = JSON.parse(read("drizzle/meta/_journal.json")) as {
      entries: Array<{ idx: number; tag: string }>
    }

    expect(journal.entries.at(-1)).toMatchObject({ idx: 57, tag: "0057_chat_tag_icons" })
    const migration = read("drizzle/0057_chat_tag_icons.sql")
    expect(migration).toContain("ADD `icon` text")
    expect(migration).toContain("'starter-important'")
    expect(migration).toContain("'starter-blocked'")
    expect(migration).toContain("'starter-follow-up'")
    expect(migration).toContain("'starter-review'")
    expect(migration).toContain("'starter-waiting'")

    const schema = read("src/main/lib/db/schema/index.ts")
    expect(schema).toContain('icon: text("icon")')
    const router = read("src/main/lib/trpc/routers/chats.ts")
    expect(router).toContain("icon: chatTagIconSchema.nullable().optional()")
    expect(router).toContain("usageByRun")
  })

  it("keeps sidebar provider chips square while showing user tag names", () => {
    const tagMenu = read("src/renderer/features/sidebar/chat-tag-menu.tsx")
    expect(tagMenu).toContain("CHAT_TAG_ICONS")
    expect(tagMenu).toContain('aria-label="Tag icon"')
    expect(tagMenu).toContain("tag.icon")
    expect(tagMenu).not.toContain("compactLabel")

    const sidebar = read("src/renderer/features/sidebar/agents-sidebar.tsx")
    expect(sidebar).toContain("chatTags.slice(0, 3)")
    expect(sidebar).not.toContain("chatTags.length > 2")
    expect(sidebar).toContain('"h-4 w-4 justify-center px-0 leading-none"')
    expect(sidebar).toContain("!hasProviderIcon && identityChipLabel")
    expect(sidebar).toContain("<ChatTagChip key={tag.id} tag={tag} compact />")
    expect(sidebar).not.toContain("compactLabel")
    expect(sidebar).not.toContain("@container/chat-row")
  })

  it("shows complete chat metadata and tags in Details for every local chat", () => {
    const info = read("src/renderer/features/details-sidebar/sections/info-section.tsx")
    expect(info).toContain("trpc.chats.getMetadata.useQuery")
    expect(info).toContain("trpc.chats.getChatStats.useQuery")
    expect(info).toContain("trpc.chats.listTagAssignments.useQuery")
    expect(info).toContain("chatStats?.totalTokens")
    for (const label of [
      "Project",
      "Provider",
      "Model",
      "Tags",
      "Messages",
      "Tokens used",
      "Context",
      "Created",
      "Updated",
    ]) {
      expect(info).toContain(`label="${label}"`)
    }

    const activeChat = read("src/renderer/features/agents/main/active-chat.tsx")
    expect(activeChat).toContain(
      "isUnifiedSidebarEnabled && !isDetailsSidebarOpen && !isMobileFullscreen",
    )
    expect(activeChat).toContain("isUnifiedSidebarEnabled && !isMobileFullscreen && (")
  })
})
