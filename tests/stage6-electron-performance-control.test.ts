import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import {
  STAGE6_PERFORMANCE_BUDGETS,
  type PerformanceBuildType,
} from "../src/main/lib/performance/budgets"
import { STAGE6_ELECTRON_CONTROL_PERFORMANCE_METRICS } from "../src/main/lib/performance/requirements"
import {
  createElectronPerformanceBuildIdentity,
  verifyElectronPerformanceBuildIdentity,
} from "../src/main/lib/performance/electron-control"
import { electronOrchestratorFailureReason } from "../src/main/lib/performance/electron-live-adapter"
import { getDevMcpTool, devMcpExposedTools } from "../src/main/lib/mcp-test-control/registry"
import { controlStage6ElectronMeasurement } from "../src/renderer/lib/stage6-electron-performance-control"
import {
  STAGE6_ELECTRON_MEASUREMENT_ROWS,
  getStage6ElectronMeasurementContract,
  stage6ElectronBudgetIds,
} from "../src/shared/stage6-electron-performance-control"
import { parseDevRendererControlRequest } from "../src/shared/dev-renderer-control"

describe("Stage 6 Electron performance control", () => {
  it("defines ten deterministic rows for all nine Electron-only metrics", () => {
    expect(STAGE6_ELECTRON_MEASUREMENT_ROWS).toHaveLength(10)
    expect(new Set(STAGE6_ELECTRON_MEASUREMENT_ROWS.map((row) => row.metric))).toEqual(
      new Set(STAGE6_ELECTRON_CONTROL_PERFORMANCE_METRICS),
    )

    for (const buildType of ["dev", "package"] satisfies PerformanceBuildType[]) {
      const expected = STAGE6_PERFORMANCE_BUDGETS.budgets
        .filter(
          (budget) =>
            budget.buildType === buildType &&
            STAGE6_ELECTRON_CONTROL_PERFORMANCE_METRICS.includes(budget.metric as never),
        )
        .map((budget) => budget.id)
      expect(stage6ElectronBudgetIds(buildType)).toEqual(expected)
      expect(expected).toHaveLength(10)
      for (const budgetId of expected) {
        const contract = getStage6ElectronMeasurementContract(budgetId)
        expect(contract).toMatchObject({
          budgetId,
          buildType,
          startMarker: expect.stringMatching(/^stage6-electron:/),
          endMarker: expect.stringMatching(/^stage6-electron:/),
          measureName: expect.stringMatching(/^stage6-electron:/),
        })
      }
    }
  })

  it("accepts only an exact budget/action/operation tuple and no caller sample", () => {
    const contract = getStage6ElectronMeasurementContract(stage6ElectronBudgetIds("dev")[0]!)
    const accepted = {
      requestId: "request-id-long-enough",
      command: "performance.measure",
      budgetId: contract.budgetId,
      action: contract.action,
      operation: "begin",
    }
    expect(parseDevRendererControlRequest(accepted)).toEqual(accepted)
    expect(
      parseDevRendererControlRequest({ ...accepted, budgetId: "renderer.anything" }),
    ).toBeNull()
    expect(parseDevRendererControlRequest({ ...accepted, action: "click-anything" })).toBeNull()
    expect(parseDevRendererControlRequest({ ...accepted, operation: "record-sample" })).toBeNull()
    expect(parseDevRendererControlRequest({ ...accepted, sample: 1 })).toBeNull()
  })

  it("binds build identity to internally observed Electron and executable material", () => {
    const first = createElectronPerformanceBuildIdentity({
      appVersion: "1.2.3",
      electronVersion: "39.8.10",
      buildType: "dev",
      executableSha256: "a".repeat(64),
      applicationSha256: "b".repeat(64),
      rendererProcessId: 42,
    })
    expect(first).toMatchObject({
      appVersion: "1.2.3",
      electronVersion: "39.8.10",
      buildType: "dev",
      executableSha256: "a".repeat(64),
      applicationSha256: "b".repeat(64),
      rendererProcessId: 42,
      identitySha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
    expect(
      createElectronPerformanceBuildIdentity({
        appVersion: "1.2.3",
        electronVersion: "39.8.11",
        buildType: "dev",
        executableSha256: "a".repeat(64),
        applicationSha256: "b".repeat(64),
        rendererProcessId: 42,
      }).identitySha256,
    ).not.toBe(first.identitySha256)
    expect(
      createElectronPerformanceBuildIdentity({
        appVersion: "1.2.3",
        electronVersion: "39.8.10",
        buildType: "dev",
        executableSha256: "a".repeat(64),
        applicationSha256: "d".repeat(64),
        rendererProcessId: 42,
      }).identitySha256,
    ).not.toBe(first.identitySha256)
    expect(
      createElectronPerformanceBuildIdentity({
        appVersion: "1.2.3",
        electronVersion: "39.8.10",
        buildType: "dev",
        executableSha256: "a".repeat(64),
        applicationSha256: "b".repeat(64),
        rendererProcessId: 43,
      }).identitySha256,
    ).not.toBe(first.identitySha256)
    expect(() =>
      verifyElectronPerformanceBuildIdentity({
        ...first,
        identitySha256: "c".repeat(64),
      }),
    ).toThrow(/identity.*digest/i)
  })

  it("records only internally timed fixed markers and never claims a budget result", async () => {
    const contract = getStage6ElectronMeasurementContract(stage6ElectronBudgetIds("dev")[4]!)
    const begun = await controlStage6ElectronMeasurement({
      budgetId: contract.budgetId,
      action: contract.action,
      operation: "begin",
    })
    expect(begun).toMatchObject({
      status: "running",
      measurementKind: "observer-interval",
      budgetEvaluated: false,
      durationMs: null,
      contract,
    })
    const finished = await controlStage6ElectronMeasurement({
      budgetId: contract.budgetId,
      action: contract.action,
      operation: "finish",
    })
    expect(finished).toMatchObject({
      status: "complete",
      measurementKind: "observer-interval",
      budgetEvaluated: false,
      durationMs: expect.any(Number),
    })
    expect(finished.durationMs).toBeGreaterThanOrEqual(0)
    expect(
      await controlStage6ElectronMeasurement({
        budgetId: contract.budgetId,
        action: contract.action,
        operation: "reset",
      }),
    ).toMatchObject({ status: "idle", durationMs: null })
  })

  it("fails closed for cold startup because an in-process renderer cannot own a restart", async () => {
    const contract = getStage6ElectronMeasurementContract(stage6ElectronBudgetIds("dev")[0]!)
    await expect(
      controlStage6ElectronMeasurement({
        budgetId: contract.budgetId,
        action: contract.action,
        operation: "sample",
      }),
    ).rejects.toThrow(/external.*process|restart/i)
  })

  it("uses the user-approved 100-exchange product transcript without hidden DOM probes", () => {
    const source = readFileSync("src/renderer/lib/stage6-electron-performance-control.ts", "utf8")
    expect(source).not.toContain("document.createElement")
    expect(source).not.toContain("-10000px")
    expect(source).not.toMatch(/for\s*\([^)]*100_000/)
    expect(source).toContain("at least 200 messages")
    expect(source).toContain("[data-chat-workbench]")
    expect(source).toContain("[data-stage6-performance-message-count]")
    expect(source).toContain("stage6-performance:configure-grid")
    expect(source).not.toMatch(
      /for\s*\(let frame[\s\S]*await observeInputPaint\(editor\)[\s\S]*current = await nextAnimationFrame/,
    )
  })

  it("selects the exact mounted chat pane and reports bounded renderer failures", () => {
    const source = readFileSync(
      "src/renderer/features/settings/dev-test-control-bridge.tsx",
      "utf8",
    )
    const selection = source.slice(
      source.indexOf('if (request.command === "chat.select")'),
      source.indexOf('if (request.command === "chat.copy")'),
    )

    expect(selection).toContain("getMountedAgentSubChatStore(request.chatId)")
    expect(selection).toContain('appStore.set(billingMethodAtom, "local-only")')
    expect(selection.indexOf('appStore.set(billingMethodAtom, "local-only")')).toBeLessThan(
      selection.indexOf("refreshDevSelectionSnapshot"),
    )
    expect(selection).toContain("trpcUtils.projects.list.invalidate()")
    expect(selection.indexOf("trpcUtils.projects.list.invalidate()")).toBeLessThan(
      selection.indexOf("appStore.set(selectedProjectAtom"),
    )
    expect(selection).not.toContain("useAgentSubChatStore.getState()")
    expect(selection).toContain("catch (error)")
    expect(selection).toContain("respondDevRendererControl")

    const server = readFileSync("src/main/lib/mcp-test-control/server.ts", "utf8")
    const selectTool = server.slice(
      server.indexOf('"select_test_chat"'),
      server.indexOf('"copy_test_chat_history"'),
    )
    expect(selectTool).toContain("prepareStage6PerformanceProfile:")
    expect(selectTool).toContain("!app.isPackaged && isStage6PerformanceProfile()")
  })

  it("gives isolated performance measurements the same bounded renderer timeout as selection", () => {
    const service = readFileSync("src/main/lib/mcp-test-control/service.ts", "utf8")
    const measurement = service.slice(
      service.indexOf("export async function controlElectronPerformanceMeasurement"),
      service.indexOf("async function runningApplicationManifestSha256"),
    )

    expect(measurement).toContain("timeoutMs: stage6PerformanceRendererSelectionTimeoutMs()")
  })

  it("uses an isolated exact-process orchestrator for startup and fixture-backed samples", () => {
    const orchestrator = readFileSync("scripts/stage6-electron-startup.mjs", "utf8")
    const rendererControl = readFileSync(
      "src/renderer/lib/stage6-electron-performance-control.ts",
      "utf8",
    )
    const searchBar = readFileSync(
      "src/renderer/features/agents/search/chat-search-bar.tsx",
      "utf8",
    )
    expect(orchestrator).toContain("classifyNativeFlapstackProcesses")
    expect(orchestrator).toContain("FLAPSTACK_DEV_INSTANCE")
    expect(orchestrator).toContain('FLAPSTACK_KEEP_RENDERER_ACTIVE: "1"')
    expect(orchestrator).not.toContain("FLAPSTACK_DEV_PORT")
    expect(orchestrator).toContain("get_test_environment")
    expect(orchestrator).toContain("await waitForRendererControlReady(client)")
    expect(orchestrator).toContain('"get_settings_state"')
    expect(orchestrator).toContain("provision_stage6_performance_fixture")
    expect(orchestrator).toContain("const fixtureMessageCount = largeFixtureAction ? 200 : 1")
    expect(orchestrator).toContain("select_test_chat")
    expect(orchestrator).not.toContain("open_test_chat")
    expect(orchestrator).toContain("control_electron_performance_measurement")
    expect(orchestrator).toMatch(/descriptor\.pid|descriptor\?\.pid/)
    expect(orchestrator).toContain("killNativeProcess")
    expect(orchestrator).toContain("drainOwnedProcessIds")
    expect(orchestrator).toContain("if (drained.stable)")
    expect(orchestrator).toContain("findStage6IsolatedNativeProcessIds")
    expect(orchestrator).toContain("rmSync(target")
    expect(orchestrator).toContain("relative(appDataRoot, target)")
    expect(orchestrator).toContain("cleanupAllOwned")
    expect(orchestrator).toContain("buildIdentities")
    expect(orchestrator).toContain("paneCount")
    expect(orchestrator).toContain("messageCount: fixture.messageCount")
    expect(orchestrator).toContain("paneCount: fixture.paneCount")
    expect(orchestrator).toContain('get_visible_copy_search_state", { subChatId }')
    expect(orchestrator).toContain("callPerformanceSampleWhenReady(launched, false)")
    expect(orchestrator).toContain("lastError")
    expect(orchestrator).toContain("isRetryableRendererReadinessError")
    expect(orchestrator).toMatch(
      /for \(let index = 0; index < warmups \+ repeats; index \+= 1\) \{\s*await ensureRepeatedSampleFixtureState\(launched, fixture\)\s*const observed = await callPerformanceSampleWhenReady\(launched, false\)/,
    )
    expect(orchestrator).toMatch(
      /async function ensureRepeatedSampleFixtureState\(launched, fixture\)[\s\S]*gridAction[\s\S]*fixture\.chatIds[\s\S]*selectExactFixtureChat[\s\S]*waitForProductReadiness[\s\S]*waitForVisibleTranscript/,
    )
    expect(orchestrator).toMatch(
      /client\.callTool\(\{ name, arguments: args \}, undefined, \{\s*timeout: timeoutMs,\s*\}\)/,
    )
    expect(rendererControl).toContain("four exact selected chats")
    expect(rendererControl).toContain('window.desktopApi?.platform === "darwin"')
    expect(rendererControl).toContain("metaKey: isMac")
    expect(rendererControl).toContain("ctrlKey: !isMac")
    expect(rendererControl).toContain("waitForSearchCompletion")
    expect(rendererControl).toContain("new MutationObserver")
    expect(searchBar).toContain("data-chat-search-completed-query")
    expect(searchBar).toContain("setCompletedQuery(inputValue)")
    expect(searchBar).toContain("useMemo(() => extractSearchableText(messages), [messages])")
    expect(searchBar).not.toContain("searchCompleted ? inputValue")
    expect(orchestrator).not.toMatch(/setTimeout\([^,]+,\s*(?:[2-9]\d{3}|\d{5,})/)
  })

  it("preserves the nested renderer readiness error from a failed Electron orchestrator", () => {
    const failure = Object.assign(new Error("Command failed: node stage6-electron-startup.mjs"), {
      stderr: Buffer.from(
        [
          "file:///C:/checkout/scripts/stage6-electron-startup.mjs:326",
          'Error: Stage 6 product sample readiness timed out: {"error":"Large-chat render requires an actual product transcript with 200 messages."}',
          "    at callPerformanceSampleWhenReady (file:///C:/checkout/scripts/stage6-electron-startup.mjs:326:9)",
        ].join("\n"),
      ),
    })

    expect(electronOrchestratorFailureReason(failure)).toBe(
      'Stage 6 product sample readiness timed out: {"error":"Large-chat render requires an actual product transcript with 200 messages."}',
    )
  })

  it("preserves a nested renderer-control timeout instead of the supervisor exit", () => {
    const failure = Object.assign(
      new Error("Command failed: node stage6-electron-supervisor.mjs"),
      {
        stderr: Buffer.from(
          [
            'Error: {"error":"Live renderer control timed out"}',
            "    at callPerformanceSample (file:///C:/checkout/scripts/stage6-electron-startup.mjs:288:20)",
            "Error: Stage 6 Electron orchestrator exited 1.",
          ].join("\n"),
        ),
      },
    )

    expect(electronOrchestratorFailureReason(failure)).toBe(
      "Stage 6 Electron child failed: Live renderer control timed out",
    )
  })

  it("does not mistake a bare structured log for the Electron child failure", () => {
    const failure = Object.assign(
      new Error("Command failed: node stage6-electron-supervisor.mjs"),
      {
        stderr: Buffer.from(
          [
            '{"error":"unrelated structured log"}',
            "Error: Stage 6 Electron orchestrator exited 1.",
          ].join("\n"),
        ),
      },
    )

    expect(electronOrchestratorFailureReason(failure)).toBe(
      "Stage 6 Electron orchestrator exited 1.",
    )
  })

  it("ignores Stage 6 text embedded in a Node source-code frame", () => {
    const failure = Object.assign(
      new Error("Command failed: node stage6-electron-supervisor.mjs"),
      {
        stderr: Buffer.from(
          [
            "file:///C:/checkout/scripts/stage6-electron-supervisor.mjs:99",
            "  throw new Error(`Stage 6 Electron orchestrator exited ${outcome.status ?? outcome.signal ?? 1}.`)",
            "        ^",
            "Error: Stage 6 Electron orchestrator exited 1.",
            "    at file:///C:/checkout/scripts/stage6-electron-supervisor.mjs:99:9",
          ].join("\n"),
        ),
      },
    )

    expect(electronOrchestratorFailureReason(failure)).toBe(
      "Stage 6 Electron orchestrator exited 1.",
    )
  })

  it("runs full acceptance under Electron ABI and restores Node ABI on every exit", () => {
    const wrapper = readFileSync("scripts/stage6-performance.mjs", "utf8")
    expect(wrapper).toContain('resolve(repositoryRoot, "scripts", "build.mjs")')
    expect(wrapper.indexOf('resolve(repositoryRoot, "scripts", "build.mjs")')).toBeLessThan(
      wrapper.indexOf("spawnSync(electronExecutable, [runtimeEntry"),
    )
    expect(wrapper).toContain('ensureNativeAbi("electron")')
    expect(wrapper).toContain('ensureNativeAbi("node")')
    expect(wrapper).toContain("FLAPSTACK_STAGE6_NODE_EXECUTABLE")
    expect(wrapper).toContain("FLAPSTACK_STAGE6_ELECTRON_EXECUTABLE")
    expect(wrapper).toContain("FLAPSTACK_STAGE6_COMPLETION_PATH")
    expect(wrapper).toContain("waitForHostedCompletion")
    expect(wrapper).toContain("cleanupHostedProcesses")
    expect(wrapper).toMatch(/spawnSync\(electronExecutable, \[runtimeEntry/)
    expect(wrapper).toMatch(/try\s*{[\s\S]*spawnSync[\s\S]*}\s*finally\s*{[\s\S]*ensureNativeAbi/)
    expect(wrapper).toMatch(/--ci[\s\S]*process\.execPath/)
    const cliEntry = readFileSync("src/main/lib/performance/cli-entry.ts", "utf8")
    expect(cliEntry).toContain("FLAPSTACK_STAGE6_COMPLETION_PATH")
    expect(cliEntry).toContain("FLAPSTACK_STAGE6_RUN_TOKEN")
    expect(cliEntry).toContain("runtimeEntry: process.argv[1]")
    const orchestrator = readFileSync("scripts/stage6-electron-startup.mjs", "utf8")
    expect(orchestrator).toContain("FLAPSTACK_STAGE6_NODE_EXECUTABLE")
    expect(orchestrator).toContain("FLAPSTACK_STAGE6_ELECTRON_EXECUTABLE")
    expect(orchestrator).toContain("FLAPSTACK_STAGE6_RUN_TOKEN")
    expect(orchestrator).toContain("delete launchEnv.ELECTRON_RENDERER_URL")
    expect(orchestrator).toMatch(/spawn\(electronExecutable, \[repositoryRoot,/)
    expect(orchestrator).not.toContain("spawn(process.execPath, [repositoryRoot]")
    expect(orchestrator).toContain('stdio: ["ignore", "pipe", "pipe"]')
    expect(orchestrator).toContain("readChildOutput")
    expect(orchestrator).toContain("process exited before readiness")
    const descriptorWait = orchestrator.slice(
      orchestrator.indexOf("async function waitForDescriptor"),
      orchestrator.indexOf("async function verifyOwnedProcess"),
    )
    expect(descriptorWait).toContain("hasOwnedDescendant")
    expect(descriptorWait).toContain("processDescendsFrom")
    expect(descriptorWait).toContain("child.exitCode !== null && !hasOwnedDescendant")
    expect(orchestrator).not.toContain("electron-vite/bin/electron-vite.js")
    expect(orchestrator).toContain('"out/main/index.js"')
    expect(orchestrator).toContain('"out/preload/index.js"')
    expect(orchestrator).toContain('"out/renderer/index.html"')
    expect(orchestrator).not.toContain("spawn(process.execPath, [bin")
    const main = readFileSync("src/main/index.ts", "utf8")
    expect(main).toContain(
      "const IS_STAGE6_PERFORMANCE = !app.isPackaged && isStage6PerformanceProfile()",
    )
    expect(main).toContain("const IS_CONTROL_DEV = IS_DEV || IS_STAGE6_PERFORMANCE")
    expect(main).toContain("if (IS_CONTROL_DEV)")
    const service = readFileSync("src/main/lib/mcp-test-control/service.ts", "utf8")
    expect(service).toMatch(
      /process\.env\.ELECTRON_RENDERER_URL\s*\? "src\/renderer"\s*: "out\/renderer"/,
    )
    const integration = readFileSync(
      "scripts/verify-stage6-electron-performance-runtime.mjs",
      "utf8",
    )
    expect(integration).toContain("stage6-electron-supervisor.mjs")
    expect(integration).toContain('ensureNativeAbi("electron")')
    expect(integration).toContain('ensureNativeAbi("node")')
    expect(integration).toContain('resolve(root, "scripts", "build.mjs")')
    expect(integration.indexOf('resolve(root, "scripts", "build.mjs")')).toBeLessThan(
      integration.indexOf('ensureNativeAbi("electron")'),
    )
    expect(integration).toContain("renderer.long-chat-render.large.dev.steady")
    expect(integration).toContain("renderer.search-response.large.dev.steady")
    expect(integration).toContain("concurrency.grid-input-response.stress.dev.steady")
    expect(integration).toContain("FLAPSTACK_STAGE6_ELECTRON_EXECUTABLE")
    expect(integration).toContain("FLAPSTACK_STAGE6_ELECTRON_ABI")
    expect(integration).toContain("ensure-native-abi-electron-probe")
    expect(integration).toContain("stage6-electron-runtime-probe.json")
    expect(integration).toContain("readFileSync(evidencePath")
    expect(integration).toContain('execFileSync("git", ["rev-parse", "HEAD"]')
    expect(integration).toMatch(
      /execFileSync\(\s*"git",\s*\["status", "--porcelain=v1", "-z", "--untracked-files=all"\]/,
    )
    expect(integration).toContain("gitSha")
    expect(integration).toContain("Stage 6 Electron runtime evidence requires a clean candidate.")
    expect(integration).toContain('"long-chat", { messageCount: 200, paneCount: 1 }')
    expect(integration).toContain('"search", { messageCount: 200, paneCount: 1 }')
    const adapter = readFileSync("src/main/lib/performance/electron-live-adapter.ts", "utf8")
    expect(adapter).toContain("FLAPSTACK_STAGE6_NODE_EXECUTABLE")
    expect(adapter).toContain("FLAPSTACK_STAGE6_ELECTRON_EXECUTABLE")
    expect(adapter).toMatch(/execFileAsync\(\s*nodeExecutable,/)
    expect(adapter).toContain("stage6-electron-supervisor.mjs")
    expect(adapter).not.toContain("timeout:")
    const supervisor = readFileSync("scripts/stage6-electron-supervisor.mjs", "utf8")
    expect(supervisor).toContain("killNativeProcess(child.pid, { force: true, tree: true })")
    expect(supervisor).toContain("FLAPSTACK_STAGE6_RUN_TOKEN")
    expect(supervisor).toContain("cleanupOwnedTree")
    expect(supervisor).toMatch(/closeCleanupError[\s\S]*cleanupOwnedTree\(\)/)
    expect(supervisor).toMatch(
      /while \(Date\.now\(\) < deadline\)[\s\S]*}\s*const finalOwned = findOwnedTree\(\)/,
    )
  })

  it("fails closed when the long-task observer is unavailable", async () => {
    const contract = getStage6ElectronMeasurementContract(stage6ElectronBudgetIds("dev")[6]!)
    const previous = globalThis.PerformanceObserver
    Object.defineProperty(globalThis, "PerformanceObserver", {
      configurable: true,
      value: undefined,
    })
    try {
      await expect(
        controlStage6ElectronMeasurement({
          budgetId: contract.budgetId,
          action: contract.action,
          operation: "sample",
        }),
      ).rejects.toThrow(/long-task.*unavailable/i)
    } finally {
      Object.defineProperty(globalThis, "PerformanceObserver", {
        configurable: true,
        value: previous,
      })
    }
  })

  it("exposes the bounded measurement control only through authenticated dev MCP", () => {
    expect(getDevMcpTool("control_electron_performance_measurement")).toMatchObject({
      tier: 1,
      mutates: true,
      status: "implemented",
    })
    expect(
      devMcpExposedTools.some((tool) => tool.name === "control_electron_performance_measurement"),
    ).toBe(true)
  })

  it("rehashes the running application for each live sample", () => {
    const source = readFileSync("src/main/lib/mcp-test-control/service.ts", "utf8")
    expect(source).not.toContain("let electronApplicationSha256")
    expect(source).toMatch(
      /requestDevRendererControlForWindow[\s\S]*runningApplicationManifestSha256\(\)/,
    )
    expect(source).toContain('require("original-fs")')
    expect(source).toContain("originalStatSync(entry).isFile()")
    expect(source).toContain("sha256File(artifact, createOriginalReadStream)")
  })
})
