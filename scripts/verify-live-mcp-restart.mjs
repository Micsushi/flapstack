#!/usr/bin/env node

import { readFile, realpath } from "node:fs/promises"
import { resolve } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { resolveDevMcpDescriptorPath, resolveDevMcpProfile } from "./lib/profile-paths.mjs"

const checkout = await realpath(resolve(process.cwd()))
const profile = resolveDevMcpProfile()
const descriptorPath = resolveDevMcpDescriptorPath(profile)
const descriptor = JSON.parse(await readFile(descriptorPath, "utf8"))
const codexChatId = process.env.FLAPSTACK_MCP_CODEX_CHAT_ID?.trim()
const claudeChatId = process.env.FLAPSTACK_MCP_CLAUDE_CHAT_ID?.trim()

assert(codexChatId && claudeChatId, "Restart proof requires both caller chat IDs")
assert((await realpath(descriptor.checkout)) === checkout, "Dev MCP checkout mismatch")

const client = new Client({ name: "flapstack-live-mcp-restart", version: "1.0.0" })
const transport = new StreamableHTTPClientTransport(new URL(descriptor.url), {
  requestInit: { headers: { Authorization: `Bearer ${descriptor.token}` } },
})
const cleanupChatIds = [codexChatId, claudeChatId].filter(Boolean)

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function toolResult(response) {
  if (response.isError) {
    const message = response.content?.find((item) => item.type === "text")?.text
    throw new Error(message || "Dev MCP tool failed")
  }
  return response.structuredContent?.result
}

async function call(name, args = {}) {
  return toolResult(await client.callTool({ name, arguments: args }))
}

async function waitForApproval(chatId) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const state = await call("get_product_mcp_state", { chatId })
    if (state.pendingApprovals[0]) return state.pendingApprovals[0]
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100))
  }
  throw new Error("Session grant incorrectly survived restart or approval did not appear")
}

async function waitForCall(callId) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const result = await call("get_product_mcp_call", { callId })
    if (result.status !== "running") return result
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100))
  }
  throw new Error("Restart proof call did not finish")
}

try {
  await client.connect(transport)
  const codexBefore = await call("get_product_mcp_state", { chatId: codexChatId, limit: 10 })
  const claudeBefore = await call("get_product_mcp_state", { chatId: claudeChatId, limit: 10 })
  assert(codexBefore.exposure.enabled, "Codex exposure did not persist")
  assert(claudeBefore.exposure.enabled, "Claude exposure did not persist")
  assert(codexBefore.audit.entries.length > 0, "Codex audit did not persist")
  assert(claudeBefore.audit.entries.length > 0, "Claude audit did not persist")

  const freshCaller = await call("prepare_product_mcp_caller", {
    harness: "codex",
    name: `Stage3 restart grant proof ${Date.now()}`,
    repoPath: checkout,
    permissionMode: "ask-before-edits",
  })
  cleanupChatIds.push(freshCaller.chatId)
  await call("set_product_mcp_exposure", { chatId: freshCaller.chatId, enabled: true })
  const started = await call("start_product_mcp_call", {
    chatId: freshCaller.chatId,
    runId: freshCaller.runId,
    toolName: "create_chat",
    arguments: {
      name: `Stage3 restart grant proof ${Date.now()}`,
      scope: "global",
      harness: "codex",
    },
  })
  const approval = await waitForApproval(freshCaller.chatId)
  await call("reply_product_mcp_approval", {
    approvalId: approval.id,
    decision: "deny",
  })
  assert((await waitForCall(started.id)).status === "failed", "Restart denial did not fail")

  console.log(
    JSON.stringify(
      {
        result: "PASS",
        checkout,
        profile,
        callers: { codex: codexChatId, claude: claudeChatId },
        proof: {
          exposurePersisted: true,
          auditPersisted: true,
          sessionGrantCleared: true,
          freshApprovalDenied: true,
        },
      },
      null,
      2,
    ),
  )
} finally {
  for (const chatId of cleanupChatIds) {
    if (chatId) await call("cleanup_product_mcp_caller", { chatId }).catch(() => undefined)
  }
  const targets = await call("list_test_targets").catch(() => null)
  for (const chat of targets?.chats ?? []) {
    if (!chat.archived && /^Stage3 (?:MCP closeout|restart grant proof)/.test(chat.name ?? "")) {
      await call("archive_test_chat", { chatId: chat.id }).catch(() => undefined)
    }
  }
  await transport.close().catch(() => undefined)
}
