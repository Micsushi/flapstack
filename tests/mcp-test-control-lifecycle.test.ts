import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import {
  isDevTestControlEnabled,
  isPreviewExecutable,
  isStage6PerformanceProfile,
  resolveFlapstackProtocol,
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
    expect(
      isDevTestControlEnabled(false, false, { FLAPSTACK_STAGE6_PERFORMANCE_PROFILE: "1" }),
    ).toBe(false)
    expect(isStage6PerformanceProfile({ FLAPSTACK_STAGE6_PERFORMANCE_PROFILE: "1" })).toBe(true)
    expect(isStage6PerformanceProfile({ FLAPSTACK_STAGE6_PERFORMANCE_PROFILE: "true" })).toBe(false)
    expect(isDevTestControlEnabled(true, false, {})).toBe(true)
  })

  it("isolates and sanitizes explicit Preview test profiles", () => {
    expect(isPreviewExecutable("C:\\Apps\\Flapstack Preview.exe")).toBe(true)
    expect(isPreviewExecutable("/Applications/Flapstack Preview")).toBe(true)
    expect(isPreviewExecutable("/opt/Flapstack-Preview/flapstack-preview")).toBe(true)
    expect(isPreviewExecutable("C:\\Apps\\Flapstack.exe")).toBe(false)
    expect(resolvePreviewUserDataName()).toBe("Flapstack Preview")
    expect(resolvePreviewUserDataName("609c/settings proof")).toBe(
      "Flapstack Preview 609c-settings-proof",
    )
  })

  it("keeps Dev, Preview, and production protocol identities separate", () => {
    expect(resolveFlapstackProtocol(true, false)).toBe("flapstack-dev")
    expect(resolveFlapstackProtocol(false, true)).toBe("flapstack-preview")
    expect(resolveFlapstackProtocol(false, false)).toBe("flapstack")
    expect(readFileSync("src/main/index.ts", "utf8")).toContain(
      "resolveFlapstackProtocol(IS_CONTROL_DEV, IS_PREVIEW)",
    )
    expect(readFileSync("src/main/index.ts", "utf8")).toContain(
      "const IS_STAGE6_PERFORMANCE = !app.isPackaged && isStage6PerformanceProfile()",
    )
    expect(readFileSync("src/main/index.ts", "utf8")).toContain(
      "enabled: isDevTestControlEnabled(IS_CONTROL_DEV, IS_PREVIEW)",
    )
    expect(readFileSync("src/main/lib/trpc/routers/debug.ts", "utf8")).toContain(
      "resolveFlapstackProtocol(IS_DEV, !IS_DEV && isPreviewExecutable())",
    )
  })

  it("uses the same Preview-only gate for the renderer router", () => {
    const source = readFileSync("src/main/lib/trpc/routers/index.ts", "utf8")
    expect(source).toContain("isDevTestControlEnabled(")
    expect(source).toContain("app.isPackaged && isPreviewExecutable()")
    expect(source).not.toContain(
      '!app.isPackaged || process.env.FLAPSTACK_ENABLE_DEV_TEST_CONTROL === "1"',
    )
  })

  it("publishes the exact isolated profile identity", () => {
    const source = readFileSync("src/main/index.ts", "utf8")
    expect(source).toContain('profile: basename(app.getPath("userData"))')
    expect(source).toContain("IS_PREVIEW")
    expect(source).toContain('"dev.flapstack.app.preview"')
    expect(source).not.toContain("profile: app.getName()")
  })

  it("validates isolated Dev descriptors against their exact profile", () => {
    const proxy = readFileSync("scripts/flapstack-dev-mcp-proxy.mjs", "utf8")
    const orchestration = readFileSync("scripts/verify-live-orchestration.mjs", "utf8")
    const providerOrchestration = readFileSync(
      "scripts/verify-live-orchestration-provider.mjs",
      "utf8",
    )
    expect(proxy).toContain("descriptor.profile !== expectedUserDataProfile")
    expect(orchestration).toContain("descriptor.profile !== profile")
    for (const driver of [orchestration, providerOrchestration]) {
      expect(driver).toContain('call("ensure_test_project")')
      expect(driver).toContain('call("archive_test_project"')
    }
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

  it("invalidates externally created chat data before selecting it", () => {
    const source = readFileSync("src/renderer/App.tsx", "utf8")
    const chatOpened = source.slice(
      source.indexOf('if (payload.action === "chat-opened")'),
      source.indexOf('if (payload.action === "orchestration-changed")'),
    )
    expect(chatOpened).toContain("trpcUtils.chats.list.invalidate()")
    expect(chatOpened).toContain("trpcUtils.chats.get.invalidate({ id: payload.chatId })")
    expect(chatOpened.indexOf("trpcUtils.chats.get.invalidate")).toBeLessThan(
      chatOpened.indexOf("setSelectedChatId(payload.chatId)"),
    )
  })

  it("allows Windows renderer control to finish cache refreshes", () => {
    const source = readFileSync("src/main/lib/mcp-test-control/service.ts", "utf8")
    expect(source).toContain('platform === "win32" ? 15_000 : 5_000')
    expect(source).toContain("resolveDevRendererControlTimeoutMs(options.timeoutMs)")
  })

  it("waits for the renderer to observe approval timeout invalidation", () => {
    const driver = readFileSync("scripts/verify-live-mcp-management.mjs", "utf8")
    expect(driver).toContain(
      "await waitForRenderer(claude.chatId, (state) => !state.backgroundApprovalVisible)",
    )
  })

  it("retries transient renderer-control timeouts on loaded Windows hosts", () => {
    const driver = readFileSync("scripts/verify-live-mcp-management.mjs", "utf8")
    expect(driver).toContain('process.platform === "win32" ? 45_000 : 15_000')
    expect(driver).toContain("lastError = error instanceof Error ? error.message : String(error)")
  })

  it("derives live fixture projects from ensure_test_project ownership", () => {
    for (const path of [
      "scripts/verify-live-orchestration.mjs",
      "scripts/verify-live-orchestration-provider.mjs",
      "scripts/verify-live-runtime-profiles.mjs",
    ]) {
      const driver = readFileSync(path, "utf8")
      expect(driver).toContain('call("ensure_test_project")')
      expect(driver).not.toContain("projectPath: checkout")
      expect(driver).not.toContain("projectName:")
    }
  })

  it("keeps Stage 4 live acceptance provider-free while exercising exact app identity", () => {
    const operations = readFileSync("scripts/verify-live-stage4-operations.mjs", "utf8")
    const profiles = readFileSync("scripts/verify-live-runtime-profiles.mjs", "utf8")
    for (const driver of [operations, profiles]) {
      expect(driver).toContain('environment.app?.channel === "development"')
      expect(driver).toContain('environment.app?.protocol === "flapstack-dev"')
    }
    expect(operations).toContain('mutate("exercise-skills-hooks-fixture"')
    expect(operations).toContain("nextRunEnforced")
    expect(profiles).toContain('action: "workflow-bind"')
    expect(profiles).toContain('action: "workflow-confirm"')
    expect(profiles).toContain("activityRetry.eventCount === 26")
    expect(profiles).toContain("providerLaunches: 0")
  })

  it("requires a real process restart before durable Stage 4 proof verification", () => {
    const driver = readFileSync("scripts/verify-live-stage4-restart.mjs", "utf8")
    expect(driver).toContain('["prepare", "verify"]')
    expect(driver).toContain("environment.app.processId !== state.preparedProcessId")
    expect(driver).toContain('action: "seed-activity"')
    expect(driver).toContain('action: "standalone-get"')
    expect(driver).toContain('call("get_test_orchestration"')
    expect(driver).toContain("operationWorkspace?.id === state.operationWorkspaceId")
    expect(driver).toContain('call("cleanup_stage4_owned_runtime_profiles")')
    expect(driver).toContain("screenControl: false")
    expect(driver).toContain("providerLaunches: 0")
  })

  it("keeps self-restarting portability apply out of the live MCP mutation surface", () => {
    const driver = readFileSync("scripts/verify-live-stage4-operations.mjs", "utf8")
    const operations = readFileSync("src/main/lib/mcp-test-control/stage4-operations.ts", "utf8")
    expect(driver).toContain('state("portability")')
    expect(driver).toContain('mutate("start-portability-lifecycle-fixture"')
    expect(driver).toContain('action: "get-portability-lifecycle-fixture"')
    expect(driver).toContain('mutate("cleanup-portability-lifecycle-fixture"')
    expect(driver).toContain("descriptor = await loadDescriptor()")
    expect(driver).toContain("while (Date.now() < deadline)")
    expect(driver).not.toContain('mutate("exercise-portability-fixture"')
    const actionSurface = operations.slice(operations.indexOf("STAGE4_OPERATIONAL_ACTIONS"))
    expect(actionSurface).not.toContain('"exercise-portability-fixture"')
    expect(actionSurface).toContain('"start-portability-lifecycle-fixture"')
    const startBranch = operations.slice(
      operations.indexOf('if (action === "start-portability-lifecycle-fixture")'),
      operations.indexOf('if (action === "get-portability-lifecycle-fixture")'),
    )
    expect(startBranch).toContain("startPortabilityLifecycleJob")
    expect(startBranch).not.toContain("runStage4PortabilityFixtureForTests")
    expect(operations).toContain("setTimeout(() =>")
    expect(operations).toContain("void executePortabilityLifecycleJob(job.jobId)")
  })

  it("runs the real Ollama lane only under an explicit live-verifier opt-in", () => {
    const driver = readFileSync(resolve("scripts", "verify-live-stage4-operations.mjs"), "utf8")
    const operations = readFileSync(
      resolve("src", "main", "lib", "mcp-test-control", "stage4-operations.ts"),
      "utf8",
    )

    expect(driver).toContain('process.env.FLAPSTACK_STAGE4_REAL_OLLAMA === "1"')
    expect(driver).toContain('mutate("exercise-real-ollama-fixture"')
    expect(driver).toContain("usage?.totalUsageRecorded === true")
    expect(driver).not.toContain("usage?.totalTokens > 0")
    expect(operations).toContain('if (action === "exercise-real-ollama-fixture")')
    expect(operations).toMatch(/procedure\(\s*localModelsRouter,\s*"catalog"/)
    expect(operations).toMatch(/procedure\(\s*localModelsRouter,\s*"chat"/)
    expect(operations).toContain("finally")
    expect(operations).toContain("usageSamples")
  })
})
