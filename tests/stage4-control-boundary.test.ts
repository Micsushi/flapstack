import { describe, expect, it } from "vitest"
import {
  sanitizeStage4ControlBoundary,
  sanitizeStage4ControlError,
} from "../src/main/lib/mcp-test-control/stage4-boundary"

describe("Stage 4 test-control boundary", () => {
  it("redacts nested activity, profile, workflow, standalone, mutation, and error content", () => {
    const value = sanitizeStage4ControlBoundary({
      id: "run-123",
      status: "completed",
      projectPath: "C:\\Users\\sushi\\private\\repo",
      activity: {
        events: [
          {
            eventId: "event-1",
            payload: { outputSummary: "Opened /home/sushi/private/activity.log" },
          },
        ],
      },
      profile: {
        profileId: "profile-1",
        version: {
          definition: {
            capability: {
              instructions:
                "Read C:\\Users\\sushi\\profile\\instructions.md with Bearer abcdefghijklmnop.",
            },
          },
        },
      },
      workflow: {
        workflowRunId: "workflow-1",
        binding: {
          overrides: { instructionAppend: "Use /opt/flapstack/private/workflow.md" },
        },
      },
      mutation: {
        status: "created",
        bundle: '{"sourcePath":"/Users/sushi/private/export.json"}',
      },
      standalone: {
        id: "launch-1",
        worktreePath: "\\\\server\\private\\standalone",
      },
    })
    const serialized = JSON.stringify(value)
    expect(value).toMatchObject({ id: "run-123", status: "completed" })
    for (const sensitive of [
      "C:\\Users\\sushi",
      "/home/sushi",
      "/opt/flapstack",
      "/Users/sushi",
      "\\\\server\\private",
      "abcdefghijklmnop",
      "activity.log",
      "instructions.md",
      "workflow.md",
      "export.json",
    ]) {
      expect(serialized).not.toContain(sensitive)
    }
    expect(serialized).toMatch(/\[path:(?:file\.[a-z0-9]+|directory):[a-f0-9]{10}\]/)

    const error = sanitizeStage4ControlError(
      new Error("Failed at C:\\Users\\sushi\\private\\repo and /home/sushi/private/repo"),
    )
    expect(error.message).not.toContain("C:\\Users\\sushi")
    expect(error.message).not.toContain("/home/sushi")
    expect(error.message).toContain("[path:")
  })

  it("recursively redacts GitHub tokens, JWTs, private keys, and single-segment paths", () => {
    const githubToken = `ghp_${"a".repeat(36)}`
    const fineGrainedToken = `github_pat_${"b".repeat(40)}`
    const jwt = `eyJ${"a".repeat(12)}.${"b".repeat(16)}.${"c".repeat(20)}`
    const unsecuredJwt = `eyJ${"d".repeat(12)}.${"e".repeat(16)}.`
    const privateKey = [
      "-----BEGIN OPENSSH PRIVATE KEY-----",
      "c3VwZXItcHJpdmF0ZS1rZXktbWF0ZXJpYWw=",
      "-----END OPENSSH PRIVATE KEY-----",
    ].join("\n")
    const value = sanitizeStage4ControlBoundary({
      stableId: "fixture-123",
      nested: [
        `token=${githubToken}`,
        {
          message: `Use ${fineGrainedToken} from /root and ${jwt}.`,
          deeper: {
            note: `${privateKey}\nNever read /etc or /root/. Compact token: ${unsecuredJwt}`,
            truncatedKey: "-----BEGIN PRIVATE KEY-----\ncGFydGlhbC1wcml2YXRlLWtleS1tYXRlcmlhbA==",
          },
        },
      ],
    })
    const serialized = JSON.stringify(value)
    expect(value).toMatchObject({ stableId: "fixture-123" })
    for (const sensitive of [
      githubToken,
      fineGrainedToken,
      jwt,
      unsecuredJwt,
      "OPENSSH PRIVATE KEY",
      "BEGIN PRIVATE KEY",
      "c3VwZXItcHJpdmF0ZS1rZXktbWF0ZXJpYWw",
      "cGFydGlhbC1wcml2YXRlLWtleS1tYXRlcmlhbA",
      "/root",
      "/etc",
    ]) {
      expect(serialized).not.toContain(sensitive)
    }
    expect(serialized).toContain("[github-token redacted]")
    expect(serialized).toContain("[jwt redacted]")
    expect(serialized).toContain("[private-key redacted]")
    expect(serialized).toMatch(/\[path:directory:[a-f0-9]{10}\]/)

    const error = sanitizeStage4ControlError(
      new Error(`token=${githubToken}; jwt=${jwt}; key=${privateKey}; path=/root`),
    )
    expect(error.message).not.toMatch(/ghp_|eyJ|PRIVATE KEY|\/root/)
  })
})
