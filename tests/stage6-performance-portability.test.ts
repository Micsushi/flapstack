import { describe, expect, it } from "vitest"
import {
  PERFORMANCE_PLATFORMS,
  STAGE6_PERFORMANCE_BUDGETS,
} from "../src/main/lib/performance/budgets"
import {
  createCandidateBinding,
  localCandidateCaptureSupport,
  observeLocalPowerProfile,
} from "../src/main/lib/performance/candidate"
import { runPerformancePlan } from "../src/main/lib/performance/runner"

const candidateInput = () => ({
  authority: "test-fixture" as const,
  gitSha: "e2f786f36be5108931f20014f8859e27386431e2",
  worktreeDigest: "b".repeat(64),
  dirty: false,
  buildId: "portable-dev-node22",
  buildType: "dev" as const,
  artifact: null,
  platform: "linux" as const,
  osRelease: "6.12.0",
  architecture: "x64" as const,
  hardwareClass: "reference-laptop" as const,
  powerProfile: "balanced-ac" as const,
  powerProfileEvidenceSha256: "d".repeat(64),
  cpuModel: "Fixture CPU 8 Core",
  logicalCores: 8,
  memoryBytes: 16 * 1024 ** 3,
  nodeVersion: "22.23.2",
  electronVersion: "39.8.10",
})

describe("Stage 6 performance portability", () => {
  it.each(PERFORMANCE_PLATFORMS)(
    "allows schema-supported %s trusted local candidate capture",
    (platform) => {
      expect(localCandidateCaptureSupport(platform)).toEqual({ supported: true })
    },
  )

  it("fails unsupported local platforms closed before candidate metadata is created", () => {
    expect(localCandidateCaptureSupport("freebsd")).toEqual({
      supported: false,
      reason: expect.stringMatching(/unavailable.*freebsd/i),
    })
  })

  it("observes Windows power mode through bounded native evidence", () => {
    const observed = observeLocalPowerProfile("win32", {
      execFile: (file, args) => {
        expect([file, args]).toEqual(["powercfg", ["/GETACTIVESCHEME"]])
        return "Power Scheme GUID: 381b4222-f694-41f0-9685-ff5bb260df2e (Balanced)"
      },
    })

    expect(observed.profile).toBe("balanced-ac")
    expect(observed.evidenceSha256).toMatch(/^[a-f0-9]{64}$/)
  })

  it("observes macOS AC and power mode without exposing native evidence", () => {
    const calls: Array<[string, readonly string[]]> = []
    const execFile = (file: string, args: readonly string[]): string => {
      calls.push([file, args])
      if (args.join(" ") === "-g batt") {
        return "Now drawing from 'AC Power'\n /Users/private-owner/secret"
      }
      return [
        "Battery Power:",
        " lowpowermode 1",
        "AC Power:",
        " lowpowermode 0",
        " powermode 2",
      ].join("\n")
    }

    const observed = observeLocalPowerProfile("darwin", { execFile })

    expect(calls).toEqual([
      ["pmset", ["-g", "batt"]],
      ["pmset", ["-g", "custom"]],
    ])
    expect(observed.profile).toBe("performance-ac")
    expect(JSON.stringify(observed)).not.toContain("private-owner")
  })

  it("observes Linux AC and platform mode from fixed sysfs paths", () => {
    const reads: string[] = []
    const observed = observeLocalPowerProfile("linux", {
      readDirectory: (path) => {
        expect(path).toBe("/sys/class/power_supply")
        return ["AC0", "BAT0"]
      },
      readTextFile: (path) => {
        reads.push(path)
        const values: Record<string, string> = {
          "/sys/class/power_supply/AC0/type": "Mains\n",
          "/sys/class/power_supply/AC0/online": "1\n",
          "/sys/class/power_supply/BAT0/type": "Battery\n",
          "/sys/firmware/acpi/platform_profile": "balanced\n",
        }
        return values[path] ?? null
      },
    })

    expect(observed.profile).toBe("balanced-ac")
    expect(reads).toEqual([
      "/sys/class/power_supply/AC0/type",
      "/sys/class/power_supply/AC0/online",
      "/sys/class/power_supply/BAT0/type",
      "/sys/firmware/acpi/platform_profile",
    ])
  })

  it("fails closed when macOS or Linux native evidence is ambiguous", () => {
    expect(() =>
      observeLocalPowerProfile("darwin", {
        execFile: (_file, args) =>
          args.join(" ") === "-g batt"
            ? "Now drawing from 'Battery Power'"
            : "AC Power:\n lowpowermode 0",
      }),
    ).toThrow(/AC power/i)

    expect(() =>
      observeLocalPowerProfile("linux", {
        readDirectory: () => ["../escape"],
        readTextFile: () => "1",
      }),
    ).toThrow(/power-supply entry/i)
  })

  it("bounds injected native power evidence before parsing it", () => {
    expect(() =>
      observeLocalPowerProfile("win32", {
        execFile: () => "x".repeat(64 * 1024 + 1),
      }),
    ).toThrow(/exceeds 64 KiB/i)

    expect(() =>
      observeLocalPowerProfile("linux", {
        readDirectory: () => Array.from({ length: 65 }, (_, index) => `AC${index}`),
        readTextFile: () => "1",
      }),
    ).toThrow(/power-supply.*exceeds 64/i)
  })

  it("keeps exact candidate metadata while redacting Windows, macOS, and Linux report paths", async () => {
    const candidate = createCandidateBinding(candidateInput())
    const budget = STAGE6_PERFORMANCE_BUDGETS.budgets.find(
      (entry) =>
        entry.buildType === candidate.buildType &&
        entry.platforms.includes(candidate.platform) &&
        entry.hardwareClasses.includes(candidate.hardwareClass),
    )!
    const outcome = await runPerformancePlan({
      candidate,
      budgetIds: [budget.id],
      measuredAt: "2026-07-30T12:00:00.000Z",
      adapters: [
        {
          id: "portable-path-redaction",
          supports: () => ({ supported: true }),
          measure: async () => {
            throw new Error(
              "failed at C:\\Users\\alice\\candidate.json, /Users/alice/report.json, and /home/alice/evidence.json",
            )
          },
        },
      ],
    })

    expect(outcome.report.candidate).toEqual(candidate)
    expect(outcome.report.omissions).toEqual([
      {
        budgetId: budget.id,
        adapterId: "portable-path-redaction",
        reason: "failed at [redacted-path], [redacted-path], and [redacted-path]",
      },
    ])
  })
})
