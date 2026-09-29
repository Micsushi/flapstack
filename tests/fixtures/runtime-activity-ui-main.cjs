const assert = require("node:assert/strict")
const { writeFileSync } = require("node:fs")
const { resolve } = require("node:path")
const output = process.env.FLAPSTACK_TIMELINE_FIXTURE_OUTPUT
if (!output) throw new Error("Owned fixture output is required")
const { app, BrowserWindow } = require("electron")
app.setPath("userData", resolve(output, "profile"))
const windows = []
const errors = []
const report = {
  kind: "production-component Electron fixture; storage-event consistency, not full-app invalidation",
  measurements: {},
  budgets: {
    initialRenderMs: 5000,
    updateAndSecondWindowMs: 2000,
    scrollMs: 2000,
    mountedRows: 40,
  },
  electronVersion: process.versions.electron,
  samples: [],
  errors,
}
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const evaluate = (window, expression) => window.webContents.executeJavaScript(expression)
const open = async () => {
  const window = new BrowserWindow({
    show: false,
    width: 1100,
    height: 850,
    webPreferences: {
      backgroundThrottling: false,
      offscreen: true,
      focusOnNavigation: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  windows.push(window)
  window.webContents.on("console-message", (_event, level, message) => {
    if (level === 3) errors.push(message)
  })
  await window.loadFile(resolve(output, "index.html"))
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await evaluate(window, 'Boolean(document.querySelector("[data-runtime-activity-key]"))'))
      return window
    await pause(20)
  }
  throw new Error("Timeline did not render")
}
const snapshot = (window) => evaluate(window, "window.runtimeTimelineFixture.snapshot()")
const verify = (value, count) => {
  assert.equal(value.count, count)
  assert(
    value.keys.length > 0 && value.keys.length <= 40,
    `Unbounded/empty DOM: ${value.keys.length}`,
  )
  assert.equal(new Set(value.keys).size, value.keys.length)
  assert(value.totals.every((total) => total === count))
  assert.equal(value.privateVisible, false)
  assert.equal(value.privateInFeedDom, false)
}
app.whenReady().then(async () => {
  try {
    const start = performance.now()
    const first = await open()
    report.measurements.initialRenderMs = performance.now() - start
    assert(report.measurements.initialRenderMs < 5000)
    const initial = await snapshot(first)
    verify(initial, 10_000)
    for (const fraction of [0, 0.25, 0.5, 0.75, 1]) {
      const began = performance.now()
      let value = await evaluate(first, `window.runtimeTimelineFixture.scroll(${fraction})`)
      if (fraction === 1) {
        for (let i = 0; i < 10 && !value.positions.includes(10_000); i++)
          value = await evaluate(first, "window.runtimeTimelineFixture.scroll(1)")
        assert(value.positions.includes(10_000))
      }
      verify(value, 10_000)
      const elapsedMs = performance.now() - began
      report.samples.push({ fraction, elapsedMs, ...value })
      assert(elapsedMs < 2000)
    }
    const exported = await evaluate(first, "window.runtimeTimelineFixture.export()")
    assert.deepEqual(
      JSON.parse(exported).map((row) => row.content),
      Array.from({ length: 10_000 }, (_, index) => index)
        .filter((index) => index % 997 !== 0)
        .map((index) => `Visible event ${index + 1}`),
    )
    assert(!exported.includes("PRIVATE_FIXTURE_SENTINEL"))
    const second = await open()
    const updateStart = performance.now()
    await evaluate(first, "window.runtimeTimelineFixture.update()")
    await pause(100)
    verify(await snapshot(first), 10_001)
    verify(await snapshot(second), 10_001)
    report.measurements.updateAndSecondWindowMs = performance.now() - updateStart
    assert(report.measurements.updateAndSecondWindowMs < 2000)
    await first.loadFile(resolve(output, "index.html"))
    await pause(200)
    verify(await snapshot(first), 10_001)
    assert.deepEqual((await snapshot(first)).keys, initial.keys)
    const reopenedExport = await evaluate(first, "window.runtimeTimelineFixture.export()")
    assert.deepEqual(
      JSON.parse(reopenedExport).map((row) => row.content),
      Array.from({ length: 10_001 }, (_, index) => index)
        .filter((index) => index % 997 !== 0)
        .map((index) => `Visible event ${index + 1}`),
    )
    assert(!reopenedExport.includes("PRIVATE_FIXTURE_SENTINEL"))
    first.destroy()
    const reopenedWindow = await open()
    verify(await snapshot(reopenedWindow), 10_001)
    assert.deepEqual((await snapshot(reopenedWindow)).keys, initial.keys)
    assert(windows.every((window) => window.isDestroyed() || !window.isVisible()))
    assert.deepEqual(errors, [])
    writeFileSync(
      resolve(output, "timeline.png"),
      (await reopenedWindow.webContents.capturePage()).toPNG(),
    )
    report.status = "passed"
    writeFileSync(resolve(output, "result.json"), JSON.stringify(report, null, 2))
    console.log(JSON.stringify({ status: "passed", output, measurements: report.measurements }))
  } catch (error) {
    report.failure = String(error)
    writeFileSync(resolve(output, "failure.json"), JSON.stringify(report, null, 2))
    process.exitCode = 1
  } finally {
    for (const window of windows) if (!window.isDestroyed()) window.destroy()
    app.exit(report.status === "passed" ? 0 : 1)
  }
})
