import { describe, expect, it } from "vitest"
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import {
  isDevTestControlEnabled,
  isHiddenPreviewVerification,
  isStage6PerformanceProfile,
  isHeadlessPerformanceProfile,
  resolvePreviewUserDataName,
} from "../src/main/lib/mcp-test-control/lifecycle"

describe("test-control lifecycle", () => {
  it("requires matching explicit Preview identity and rejects mixed or shared hidden profiles", () => {
    const executable = "C:\\Apps\\Flapstack Preview.exe"
    const resources = mkdtempSync(resolve(tmpdir(), "flapstack-preview-identity-"))
    const provenance = resolve(resources, "package-provenance.json")
    writeFileSync(
      provenance,
      JSON.stringify({
        build: { channel: "preview" },
        package: { productName: "Flapstack Preview" },
      }),
    )
    try {
      const env = {
        FLAPSTACK_PREVIEW_HEADLESS: "1",
        FLAPSTACK_PREVIEW_INSTANCE: "preview-bridge-123-abc",
        FLAPSTACK_PREVIEW_RUN_TOKEN: "pb-123-abc-012345abcdef",
      }
      expect(isHeadlessPerformanceProfile(true, env, executable, resources)).toBe(true)
      expect(isHiddenPreviewVerification(env)).toBe(true)
      expect(resolvePreviewUserDataName(env.FLAPSTACK_PREVIEW_INSTANCE)).toBe(
        "Flapstack Preview preview-bridge-123-abc",
      )
      expect(isDevTestControlEnabled(false, true, env)).toBe(false)
      expect(() => isHeadlessPerformanceProfile(false, env, executable, resources)).toThrow(
        "Preview",
      )
      expect(() => isHeadlessPerformanceProfile(true, env, "C:\\Apps\\Flapstack.exe")).toThrow(
        "Preview",
      )
      for (const [field, value] of [
        ["FLAPSTACK_PREVIEW_HEADLESS", "true"],
        ["FLAPSTACK_PREVIEW_HEADLESS", ""],
        ["FLAPSTACK_PREVIEW_INSTANCE", ""],
        ["FLAPSTACK_PREVIEW_INSTANCE", "preview-bridge-123-abc/other"],
        ["FLAPSTACK_PREVIEW_RUN_TOKEN", "pb-456-abc-012345abcdef"],
        ["FLAPSTACK_PREVIEW_RUN_TOKEN", ""],
        ["FLAPSTACK_STAGE6_HEADLESS", "1"],
        ["FLAPSTACK_STAGE6_PERFORMANCE_PROFILE", "1"],
        ["FLAPSTACK_DEV_INSTANCE", "other"],
        ["FLAPSTACK_DEV_MCP_PROFILE", "other"],
        ["FLAPSTACK_ENABLE_DEV_TEST_CONTROL", "1"],
      ]) {
        expect(() =>
          isHeadlessPerformanceProfile(true, { ...env, [field]: value }, executable, resources),
        ).toThrow("Preview")
      }
      for (const value of [
        "invalid json",
        "null",
        JSON.stringify({
          build: { channel: "release" },
          package: { productName: "Flapstack Preview" },
        }),
        JSON.stringify({ build: { channel: "preview" }, package: { productName: "Flapstack" } }),
      ]) {
        writeFileSync(provenance, value)
        expect(() => isHeadlessPerformanceProfile(true, env, executable, resources)).toThrow(
          "provenance",
        )
      }
      unlinkSync(provenance)
      expect(() => isHeadlessPerformanceProfile(true, env, executable, resources)).toThrow(
        "provenance",
      )
    } finally {
      try {
        unlinkSync(provenance)
      } catch {}
      rmdirSync(resources)
    }
  })

  it("stays disabled in packages unless the exact test flag is present", () => {
    expect(isDevTestControlEnabled(false, false, {})).toBe(false)
    expect(
      isDevTestControlEnabled(false, true, { FLAPSTACK_ENABLE_DEV_TEST_CONTROL: "true" }),
    ).toBe(false)
    expect(isDevTestControlEnabled(false, true, { FLAPSTACK_ENABLE_DEV_TEST_CONTROL: "1" })).toBe(
      true,
    )
    expect(isDevTestControlEnabled(false, false, { FLAPSTACK_ENABLE_DEV_TEST_CONTROL: "1" })).toBe(
      false,
    )
    expect(
      isDevTestControlEnabled(false, false, { FLAPSTACK_STAGE6_PERFORMANCE_PROFILE: "1" }),
    ).toBe(false)
    expect(isStage6PerformanceProfile({ FLAPSTACK_STAGE6_PERFORMANCE_PROFILE: "1" })).toBe(true)
    expect(isStage6PerformanceProfile({ FLAPSTACK_STAGE6_PERFORMANCE_PROFILE: "true" })).toBe(false)
    expect(isDevTestControlEnabled(true, false, {})).toBe(true)
  })
})
