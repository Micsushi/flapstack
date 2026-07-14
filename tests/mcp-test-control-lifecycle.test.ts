import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import {
  isDevTestControlEnabled,
  resolvePreviewUserDataName,
} from "../src/main/lib/mcp-test-control/lifecycle"

describe("test-control lifecycle", () => {
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
    expect(isDevTestControlEnabled(true, false, {})).toBe(true)
  })

  it("isolates and sanitizes explicit Preview test profiles", () => {
    expect(resolvePreviewUserDataName()).toBe("Flapstack Preview")
    expect(resolvePreviewUserDataName("609c/settings proof")).toBe(
      "Flapstack Preview 609c-settings-proof",
    )
  })

  it("uses the same Preview-only gate for the renderer router", () => {
    const source = readFileSync("src/main/lib/trpc/routers/index.ts", "utf8")
    expect(source).toContain("isDevTestControlEnabled(")
    expect(source).toContain('basename(process.execPath) === "Flapstack Preview"')
    expect(source).not.toContain(
      '!app.isPackaged || process.env.FLAPSTACK_ENABLE_DEV_TEST_CONTROL === "1"',
    )
  })

  it("publishes the exact isolated profile identity", () => {
    const source = readFileSync("src/main/index.ts", "utf8")
    expect(source).toContain('profile: basename(app.getPath("userData"))')
    expect(source).not.toContain("profile: app.getName()")
  })

  it("validates isolated Dev descriptors against their exact profile", () => {
    const proxy = readFileSync("scripts/flapstack-dev-mcp-proxy.mjs", "utf8")
    const orchestration = readFileSync("scripts/verify-live-orchestration.mjs", "utf8")
    expect(proxy).toContain("descriptor.profile !== expectedUserDataProfile")
    expect(orchestration).toContain("descriptor.profile !== profile")
  })

  it("invalidates the project cache before selecting externally created test projects", () => {
    const source = readFileSync("src/renderer/App.tsx", "utf8")
    const driver = readFileSync("scripts/verify-live-mcp-management.mjs", "utf8")
    const projectCreated = source.slice(
      source.indexOf('if (payload.action === "project-created")'),
      source.indexOf('if (payload.action === "project-archived")'),
    )
    expect(projectCreated.indexOf("trpcUtils.projects.list.invalidate()")).toBeGreaterThanOrEqual(0)
    expect(projectCreated.indexOf("trpcUtils.projects.list.invalidate()")).toBeLessThan(
      projectCreated.indexOf("trpcUtils.projects.list.fetch()"),
    )
    expect(driver).toContain('call("ensure_test_project")')
    expect(driver).toContain('call("archive_test_project"')
  })
})
