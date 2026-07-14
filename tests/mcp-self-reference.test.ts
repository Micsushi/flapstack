import { describe, expect, it } from "vitest"
import { evaluateMcpGate } from "../src/main/lib/mcp-control/gate"
import {
  evaluateMcpGateWithSelfReference,
  evaluateMcpSelfReference,
  type McpSelfReferenceCaller,
} from "../src/main/lib/mcp-control/self-reference"
import type {
  McpSelfReferenceOperation,
  McpSelfReferenceTargetKind,
} from "../src/main/lib/mcp-control/types"

const caller: McpSelfReferenceCaller = {
  chatId: "chat-self",
  runId: "run-self",
  taskId: "task-self",
  projectId: "project-self",
}

const operations: readonly McpSelfReferenceOperation[] = [
  "rename",
  "move",
  "archive",
  "write",
  "launch",
  "spawn",
]
const targetKinds: readonly McpSelfReferenceTargetKind[] = ["chat", "run", "task", "project"]

const expectedOwnDecisions: Record<
  McpSelfReferenceOperation,
  Record<McpSelfReferenceTargetKind, "allowed" | "denied">
> = {
  rename: { chat: "allowed", run: "allowed", task: "allowed", project: "allowed" },
  move: { chat: "denied", run: "denied", task: "denied", project: "denied" },
  archive: { chat: "denied", run: "denied", task: "denied", project: "denied" },
  write: { chat: "allowed", run: "allowed", task: "allowed", project: "allowed" },
  launch: { chat: "denied", run: "denied", task: "denied", project: "denied" },
  spawn: { chat: "denied", run: "denied", task: "denied", project: "denied" },
}

describe("MCP self-reference safety matrix", () => {
  it("covers every operation and own target combination", () => {
    for (const operation of operations) {
      for (const kind of targetKinds) {
        const targetId = caller[`${kind}Id`]
        expect(targetId).toBeTruthy()
        const result = evaluateMcpSelfReference({
          caller,
          operation,
          target: { kind, id: targetId! },
        })
        expect(result.decision).toBe(expectedOwnDecisions[operation][kind])
        if (result.decision === "denied") {
          expect(result.blockedReason).toEqual({
            code: "self-reference",
            operation,
            targetKind: kind,
            targetId,
          })
        }
      }
    }
  })

  it("allows targets outside the caller execution context", () => {
    for (const operation of operations) {
      for (const kind of targetKinds) {
        expect(
          evaluateMcpSelfReference({ caller, operation, target: { kind, id: `${kind}-other` } }),
        ).toMatchObject({ decision: "allowed" })
      }
    }
  })

  it("does not turn a prior gate denial or approval requirement into permission", () => {
    const denied = evaluateMcpGate({ tier: 1, permissionMode: "read-only" })
    expect(
      evaluateMcpGateWithSelfReference({
        gate: denied,
        caller,
        operation: "rename",
        target: { kind: "chat", id: caller.chatId },
      }),
    ).toEqual(denied)

    const approvalRequired = evaluateMcpGate({ tier: 3, permissionMode: "full-access" })
    expect(
      evaluateMcpGateWithSelfReference({
        gate: approvalRequired,
        caller,
        operation: "write",
        target: { kind: "project", id: caller.projectId! },
      }),
    ).toEqual(approvalRequired)
  })

  it("makes a self-reference denial override a previously allowed F3-T1 decision", () => {
    expect(
      evaluateMcpGateWithSelfReference({
        gate: evaluateMcpGate({ tier: 2, permissionMode: "full-access" }),
        caller,
        operation: "archive",
        target: { kind: "run", id: caller.runId! },
      }),
    ).toMatchObject({
      decision: "denied",
      requiresApproval: false,
      blockedReason: { code: "self-reference", operation: "archive", targetKind: "run" },
    })
  })
})
