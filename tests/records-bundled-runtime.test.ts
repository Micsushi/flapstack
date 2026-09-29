import { test, expect } from "vitest"
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import {
  managedRecordsConnection,
  startProjectRecordsRuntime,
} from "../src/main/lib/project-records/runtime"
import { configuredProjectRecordsClient } from "../src/main/lib/project-records/client"

test("bundled standalone SQL shares Board and MCP writes and survives restart without a checkout", async () => {
  const userData = await mkdtemp(join(tmpdir(), "flapstack-bundled-records-"))
  const env: NodeJS.ProcessEnv = { ...process.env }
  for (const name of ["MODE", "URL", "TOKEN", "TOKEN_FILE", "DATA", "SOURCE"])
    delete env[`FLAPSTACK_PROJECT_RECORDS_${name}`]
  env.PROJECT_RECORDS_TOKEN = "ambient-token-must-not-override-managed-auth"
  env.PROJECT_RECORDS_TOKEN_FILE = "nonexistent-ambient-token-file"
  const options = {
    userData,
    snapshotPath: resolve("resources/project-records-runtime.json.gz"),
    env,
  }
  let stop: (() => void) | undefined
  try {
    stop = await startProjectRecordsRuntime(options)
    expect(env.FLAPSTACK_PROJECT_RECORDS_TOKEN_FILE).toBeUndefined()
    expect(env.FLAPSTACK_PROJECT_RECORDS_TOKEN).toBeUndefined()
    expect(env.FLAPSTACK_PROJECT_RECORDS_URL).toBeUndefined()
    let client = await configuredProjectRecordsClient(env)
    const ownerConnection = managedRecordsConnection(env)!
    const connectedEnv: NodeJS.ProcessEnv = {
      ...env,
      FLAPSTACK_PROJECT_RECORDS_MODE: "connected",
      FLAPSTACK_PROJECT_RECORDS_URL: ownerConnection.endpoint,
      FLAPSTACK_PROJECT_RECORDS_TOKEN_FILE: ownerConnection.tokenFile,
      PROJECT_RECORDS_TOKEN: "must-not-leak",
      PROJECT_RECORDS_TOKEN_FILE: "must-not-leak-file",
    }
    const stopConnected = await startProjectRecordsRuntime({ ...options, env: connectedEnv })
    expect(connectedEnv.FLAPSTACK_PROJECT_RECORDS_TOKEN_FILE).toBeUndefined()
    expect(connectedEnv.PROJECT_RECORDS_TOKEN).toBeUndefined()
    expect(connectedEnv.PROJECT_RECORDS_TOKEN_FILE).toBeUndefined()
    const connectedClient = await configuredProjectRecordsClient(connectedEnv)
    expect(
      (await connectedClient.boardRequest({ path: "/v1/storage", method: "GET" })).status,
    ).toBe(200)
    stopConnected()
    const inlineEnv: NodeJS.ProcessEnv = {
      FLAPSTACK_PROJECT_RECORDS_MODE: "connected",
      FLAPSTACK_PROJECT_RECORDS_URL: ownerConnection.endpoint,
      FLAPSTACK_PROJECT_RECORDS_TOKEN: await readFile(ownerConnection.tokenFile!, "utf8"),
    }
    const stopInline = await startProjectRecordsRuntime({ ...options, env: inlineEnv })
    expect(inlineEnv.FLAPSTACK_PROJECT_RECORDS_TOKEN).toBeUndefined()
    expect(
      (
        await (
          await configuredProjectRecordsClient(inlineEnv)
        ).boardRequest({ path: "/v1/storage", method: "GET" })
      ).status,
    ).toBe(200)
    stopInline()
    expect((await client.boardRequest({ path: "/v1/storage", method: "GET" })).status).toBe(200)
    const storage = await client.boardRequest({ path: "/v1/storage", method: "GET" })
    expect(storage.status).toBe(200)
    expect(storage.body).toContain('"sqlite"')
    const created = (await client.createRecord({
      kind: "task",
      title: "Board created",
      description: "Verify shared SQL storage without launching any worker.",
      projectId: "integration",
      projectName: "Integration",
      requestId: "bundled-integration",
    })) as { path: string; recordId: string; revision: string }
    const read = await client.read(created.path)
    const id = created.recordId
    expect(read.document.records.find((record) => record.id === id)?.title).toBe("Board created")
    const [revision] = await readdir(join(userData, "records-runtime"))
    const adapter = join(userData, "records-runtime", revision, "board_mcp.py")
    const mcp = (name: string, args: Record<string, unknown>) => {
      const result = spawnSync(
        env.FLAPSTACK_PROJECT_RECORDS_PYTHON || "python",
        [
          adapter,
          "--url",
          managedRecordsConnection(env)!.endpoint,
          "--token-file",
          managedRecordsConnection(env)!.tokenFile!,
        ],
        {
          windowsHide: true,
          encoding: "utf8",
          timeout: 10_000,
          env: { ...env, PROJECT_RECORDS_TOOLS: "records_read,records_patch" },
          input:
            JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              method: "tools/call",
              params: { name, arguments: args },
            }) + "\n",
        },
      )
      expect(result.status, result.stderr).toBe(0)
      const response = JSON.parse(result.stdout)
      expect(response.error).toBeUndefined()
      expect(response.result.isError).toBe(false)
      return JSON.parse(response.result.content[0].text)
    }
    expect(mcp("records_read", { recordId: id }).record.title).toBe("Board created")
    mcp("records_patch", {
      recordId: id,
      expectedRevision: read.revision,
      changes: { title: "MCP updated" },
    })
    const updated = await client.read(created.path)
    expect(updated.document.records.find((record) => record.id === id)?.title).toBe("MCP updated")
    const patched = await client.patch({
      path: created.path,
      recordId: id,
      expectedRevision: updated.revision,
      changes: { title: "Board updated again" },
    })
    expect(patched.conflict).toBe(false)
    expect(mcp("records_read", { recordId: id }).record.title).toBe("Board updated again")
    stop()
    delete env.FLAPSTACK_PROJECT_RECORDS_URL
    delete env.FLAPSTACK_PROJECT_RECORDS_TOKEN_FILE
    stop = await startProjectRecordsRuntime(options)
    client = await configuredProjectRecordsClient(env)
    expect(
      (await client.read(created.path)).document.records.find((record) => record.id === id)?.title,
    ).toBe("Board updated again")
  } finally {
    stop?.()
    await rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
}, 30_000)
