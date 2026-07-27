const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const pty = require("node-pty")
const { app } = require("electron")

const cwd = process.argv[2]
const legacyBehavior = ["completion", "cancellation"].includes(process.argv[3])
  ? process.argv[3]
  : null
const shellKind = legacyBehavior ? "powershell" : (process.argv[3] ?? "powershell")
const behavior = legacyBehavior ?? process.argv[4] ?? "completion"
const inputValue = "typed-雪"
const environmentValue = "terminal-env-雪"
const unicodeValue = "雪"

function writeFixtureFiles() {
  const profilePath = path.join(cwd, "flapstack-test-profile.ps1")
  const powershellRunner = path.join(cwd, `flapstack-test-${behavior}.ps1`)
  const cmdRunnerRoot = fs.mkdtempSync(path.join(os.tmpdir(), "flapstack-node-pty-cmd-"))
  const cmdRunner = path.join(cmdRunnerRoot, `flapstack-test-${behavior}.cmd`)
  fs.writeFileSync(
    profilePath,
    `\ufeff${[
      "[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)",
      "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
      "$global:OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
      'Write-Output "__FLAPSTACK_PROFILE__isolated-powershell"',
      "",
    ].join("\r\n")}`,
    "utf8",
  )
  fs.writeFileSync(
    powershellRunner,
    `\ufeff${
      behavior === "completion"
        ? [
            `. '${profilePath.replaceAll("'", "''")}'`,
            'Write-Output ("__FLAPSTACK_CWD__" + (Get-Location).Path)',
            'Write-Output ("__FLAPSTACK_ENV__" + $env:AGENTS_PANE_ID)',
            'Write-Output ("__FLAPSTACK_UNICODE__" + $env:FLAPSTACK_UNICODE_VALUE)',
            'Write-Output "__FLAPSTACK_INPUT_READY__"',
            "$value = Read-Host",
            'Write-Output ("__FLAPSTACK_INPUT__" + $value)',
            "exit 17",
            "",
          ].join("\r\n")
        : [
            `. '${profilePath.replaceAll("'", "''")}'`,
            'Write-Output "__FLAPSTACK_CANCEL_READY__"',
            "while ($true) { Start-Sleep -Milliseconds 100 }",
            "",
          ].join("\r\n")
    }`,
    "utf8",
  )
  fs.writeFileSync(
    cmdRunner,
    behavior === "completion"
      ? [
          "@echo off",
          "setlocal EnableDelayedExpansion",
          "chcp 65001 >nul",
          "echo __FLAPSTACK_PROFILE__cmd-default",
          "echo __FLAPSTACK_CWD__!CD!",
          "echo __FLAPSTACK_ENV__!AGENTS_PANE_ID!",
          "echo __FLAPSTACK_UNICODE__!FLAPSTACK_UNICODE_VALUE!",
          "echo __FLAPSTACK_INPUT_READY__",
          "set /p FLAPSTACK_TYPED=",
          "echo __FLAPSTACK_INPUT__!FLAPSTACK_TYPED!",
          "exit /b 17",
          "",
        ].join("\r\n")
      : [
          "@echo off",
          "chcp 65001 >nul",
          "echo __FLAPSTACK_CANCEL_READY__",
          ":loop",
          "ping.exe -n 2 127.0.0.1 >nul",
          "goto loop",
          "",
        ].join("\r\n"),
    "utf8",
  )
  return { powershellRunner, cmdRunner, cmdRunnerRoot }
}

function shellConfiguration(files) {
  if (shellKind === "cmd") {
    return {
      shell: path.join(process.env.SystemRoot, "System32", "cmd.exe"),
      args: ["/D", "/Q", "/C", files.cmdRunner],
    }
  }
  if (shellKind !== "powershell") throw new Error(`Unsupported shell fixture: ${shellKind}`)
  return {
    shell: path.join(
      process.env.SystemRoot,
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    ),
    args: ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", files.powershellRunner],
  }
}

function runPty(configuration) {
  return new Promise((resolve, reject) => {
    let output = ""
    let settled = false
    let inputSent = false
    const terminal = pty.spawn(configuration.shell, configuration.args, {
      name: "xterm-256color",
      cols: 100,
      rows: 30,
      cwd,
      env: {
        ...process.env,
        AGENTS_PANE_ID: environmentValue,
        FLAPSTACK_UNICODE_VALUE: unicodeValue,
      },
      useConpty: false,
    })
    terminal.resize(120, 40)
    terminal.onData((data) => {
      output += data
      if (behavior === "completion" && !inputSent && output.includes("__FLAPSTACK_INPUT_READY__")) {
        inputSent = true
        terminal.write(`${inputValue}\r`)
      }
      if (behavior === "cancellation" && output.includes("__FLAPSTACK_CANCEL_READY__")) {
        terminal.kill()
      }
    })
    terminal.onExit(({ exitCode, signal }) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      resolve({ output, exitCode, signal })
    })
    const timeout = setTimeout(() => {
      if (settled) return
      terminal.kill()
      reject(new Error("node-pty fixture timed out"))
    }, 15_000)
  })
}

async function main() {
  fs.mkdirSync(cwd, { recursive: true })
  const files = writeFixtureFiles()
  let result
  try {
    result = await runPty(shellConfiguration(files))
  } finally {
    fs.rmSync(files.cmdRunnerRoot, { recursive: true, force: true })
  }
  await new Promise((resolve) =>
    process.stdout.write(
      `${JSON.stringify({
        result,
        ...(behavior === "completion" ? { completion: result } : { cancellation: result }),
        shellKind,
        behavior,
        expectedCwd: path.resolve(cwd),
        expectedEnvironment: environmentValue,
        expectedInput: inputValue,
        platform: os.platform(),
        arch: os.arch(),
      })}\n`,
      resolve,
    ),
  )
  app.exit(0)
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  app.exit(1)
})
