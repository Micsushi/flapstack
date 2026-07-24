import { describe, expect, it, vi } from "vitest"
// @ts-expect-error JavaScript build-script helper intentionally has no declaration file.
import {
  createIsolatedTestGitEnvironment,
  runWithIsolatedTestGitEnvironment,
} from "../scripts/lib/test-git-environment.mjs"

describe("isolated test Git environment", () => {
  it("runs a command with isolated Git config and always cleans it", () => {
    const cleanup = vi.fn()
    const create = vi.fn(() => ({
      env: { PATH: "tool-path", GIT_CONFIG_GLOBAL: "C:\\Temp\\isolated-config" },
      cleanup,
    }))
    const run = vi.fn(() => {
      throw new Error("gate failed")
    })

    expect(() => runWithIsolatedTestGitEnvironment(run, { create })).toThrow("gate failed")
    expect(run).toHaveBeenCalledWith({
      PATH: "tool-path",
      GIT_CONFIG_GLOBAL: "C:\\Temp\\isolated-config",
    })
    expect(cleanup).toHaveBeenCalledOnce()
  })

  it("copies only the human identity into a temporary global config", () => {
    const calls: Array<{ command: string; args: string[] }> = []
    const remove = vi.fn()
    const spawn = (command: string, args: string[]) => {
      calls.push({ command, args })
      if (args.join(" ").endsWith("user.name")) {
        return { status: 0, stdout: "Human User\n", stderr: "" }
      }
      if (args.join(" ").endsWith("user.email")) {
        return { status: 0, stdout: "human@example.com\n", stderr: "" }
      }
      return { status: 0, stdout: "", stderr: "" }
    }

    const isolated = createIsolatedTestGitEnvironment({
      env: { PATH: "tool-path" },
      makeDirectory: () => "C:\\Temp\\flapstack-test-git",
      remove,
      spawn,
    })

    expect(calls).toEqual([
      { command: "git", args: ["config", "--global", "--get", "user.name"] },
      { command: "git", args: ["config", "--global", "--get", "user.email"] },
      {
        command: "git",
        args: [
          "config",
          "--file",
          "C:\\Temp\\flapstack-test-git\\config",
          "user.name",
          "Human User",
        ],
      },
      {
        command: "git",
        args: [
          "config",
          "--file",
          "C:\\Temp\\flapstack-test-git\\config",
          "user.email",
          "human@example.com",
        ],
      },
    ])
    expect(isolated.env).toEqual({
      PATH: "tool-path",
      GIT_CONFIG_GLOBAL: "C:\\Temp\\flapstack-test-git\\config",
    })

    isolated.cleanup()
    expect(remove).toHaveBeenCalledWith("C:\\Temp\\flapstack-test-git", {
      recursive: true,
      force: true,
    })
  })

  it("uses a test-only identity when the runner has no global Git identity", () => {
    const calls: Array<{ command: string; args: string[] }> = []
    const spawn = (command: string, args: string[]) => {
      calls.push({ command, args })
      if (args.includes("--get")) {
        return { status: 1, stdout: "", stderr: "" }
      }
      return { status: 0, stdout: "", stderr: "" }
    }

    const isolated = createIsolatedTestGitEnvironment({
      env: { CI: "true", PATH: "tool-path" },
      makeDirectory: () => "C:\\Temp\\flapstack-test-git",
      remove: vi.fn(),
      spawn,
    })

    expect(calls).toEqual([
      { command: "git", args: ["config", "--global", "--get", "user.name"] },
      { command: "git", args: ["config", "--global", "--get", "user.email"] },
      {
        command: "git",
        args: [
          "config",
          "--file",
          "C:\\Temp\\flapstack-test-git\\config",
          "user.name",
          "Flapstack Test",
        ],
      },
      {
        command: "git",
        args: [
          "config",
          "--file",
          "C:\\Temp\\flapstack-test-git\\config",
          "user.email",
          "flapstack-test@example.invalid",
        ],
      },
    ])

    isolated.cleanup()
  })
})
