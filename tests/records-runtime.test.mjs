import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { gzipSync } from "node:zlib"
import {
  startProjectRecordsRuntime,
  projectRecordsStartupFailure,
  managedRecordsConnection,
} from "../src/main/lib/project-records/runtime.ts"
import { projectRecordsEnabled } from "../src/main/lib/project-records/mode.ts"

test("explicit Records modes never allow legacy fallback", async () => {
  assert.equal(projectRecordsEnabled({ FLAPSTACK_PROJECT_RECORDS_MODE: "standalone" }), true)
  assert.equal(projectRecordsEnabled({ FLAPSTACK_PROJECT_RECORDS_MODE: "connected" }), true)
  assert.equal(projectRecordsEnabled({}), false)
  assert.equal(projectRecordsEnabled({ FLAPSTACK_PROJECT_RECORDS_TOKEN_FILE: "private" }), true)
  const options = { userData: "unused", snapshotPath: "unused" }
  await assert.rejects(
    startProjectRecordsRuntime({
      ...options,
      env: { FLAPSTACK_PROJECT_RECORDS_MODE: "connected" },
    }),
    /requires/,
  )
  await assert.rejects(
    startProjectRecordsRuntime({
      ...options,
      env: { FLAPSTACK_PROJECT_RECORDS_TOKEN_FILE: "private" },
    }),
    /requires/,
  )
  await assert.rejects(
    startProjectRecordsRuntime({
      ...options,
      env: {
        FLAPSTACK_PROJECT_RECORDS_MODE: "standalone",
        FLAPSTACK_PROJECT_RECORDS_URL: "http://127.0.0.1:1234",
      },
    }),
    /cannot also/,
  )
  await assert.rejects(
    startProjectRecordsRuntime({ ...options, env: { FLAPSTACK_PROJECT_RECORDS_MODE: "typo" } }),
    /Unknown/,
  )
  const env = { FLAPSTACK_PROJECT_RECORDS_URL: "http://127.0.0.1:1234" }
  const stop = await startProjectRecordsRuntime({ ...options, env })
  stop()
  assert.equal(env.FLAPSTACK_PROJECT_RECORDS_URL, "http://127.0.0.1:1234")
  const invalid = {
    FLAPSTACK_PROJECT_RECORDS_TOKEN: "owner-secret",
    PROJECT_RECORDS_TOKEN: "other-secret",
    PROJECT_RECORDS_TOKEN_FILE: "private",
  }
  await assert.rejects(startProjectRecordsRuntime({ ...options, env: invalid }), /requires/)
  assert.equal(invalid.FLAPSTACK_PROJECT_RECORDS_TOKEN, undefined)
  assert.equal(invalid.PROJECT_RECORDS_TOKEN, undefined)
  assert.equal(invalid.PROJECT_RECORDS_TOKEN_FILE, undefined)
  assert.equal(projectRecordsEnabled(invalid), true)
})

test("managed service initializes local data and verifies authentication", async () => {
  const root = await mkdtemp(join(tmpdir(), "flapstack-records-test-"))
  const script = `import sys, pathlib, http.server, json
args = sys.argv
database = pathlib.Path(args[args.index('--database')+1])
if args[1] == 'init-sql':
 database.write_text('created once')
 sys.exit(0)
token = pathlib.Path(args[args.index('--token-file')+1]).read_text().strip()
class Handler(http.server.BaseHTTPRequestHandler):
 def do_GET(self):
  self.send_response(200 if self.headers.get('Authorization') == 'Bearer '+token else 401)
  self.end_headers()
  self.wfile.write(json.dumps({'backend':'sqlite'}).encode())
server = http.server.HTTPServer(('127.0.0.1',0), Handler)
print('Project records writer listening on http://127.0.0.1:'+str(server.server_port),flush=True)
server.serve_forever()
`
  const snapshotPath = join(root, "runtime.gz")
  await writeFile(snapshotPath, gzipSync(JSON.stringify({ files: { "writer.py": script } })))
  let stop
  try {
    const env = { ...process.env }
    delete env.FLAPSTACK_PROJECT_RECORDS_MODE
    delete env.FLAPSTACK_PROJECT_RECORDS_URL
    delete env.FLAPSTACK_PROJECT_RECORDS_TOKEN
    delete env.FLAPSTACK_PROJECT_RECORDS_TOKEN_FILE
    delete env.FLAPSTACK_PROJECT_RECORDS_DATA
    stop = await startProjectRecordsRuntime({ userData: root, snapshotPath, env })
    assert.equal(env.FLAPSTACK_PROJECT_RECORDS_MODE, "standalone")
    assert.equal(projectRecordsEnabled(env), true)
    const connection = managedRecordsConnection(env)
    assert.match(connection.endpoint, /^http:\/\/127\.0\.0\.1:\d+$/)
    assert.equal(env.FLAPSTACK_PROJECT_RECORDS_URL, undefined)
    assert.equal(env.FLAPSTACK_PROJECT_RECORDS_TOKEN_FILE, undefined)
    assert.equal(
      await readFile(join(root, "project-records", "records.sqlite3"), "utf8"),
      "created once",
    )
    const token = await readFile(connection.tokenFile, "utf8")
    assert.equal(token.length, 64)
    assert.equal((await fetch(`${connection.endpoint}/v1/storage`)).status, 401)
    stop()
    await writeFile(join(root, "project-records", "records.sqlite3"), "retained data")
    delete env.FLAPSTACK_PROJECT_RECORDS_URL
    delete env.FLAPSTACK_PROJECT_RECORDS_TOKEN_FILE
    stop = await startProjectRecordsRuntime({ userData: root, snapshotPath, env })
    assert.equal(
      await readFile(join(root, "project-records", "records.sqlite3"), "utf8"),
      "retained data",
    )
    assert.equal(await readFile(managedRecordsConnection(env).tokenFile, "utf8"), token)
  } finally {
    stop?.()
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 })
  }
})

test("failed default startup retains Records authority without opening legacy writes", async () => {
  const root = await mkdtemp(join(tmpdir(), "flapstack-records-failure-"))
  const env = {}
  try {
    await assert.rejects(
      startProjectRecordsRuntime({ userData: root, snapshotPath: join(root, "missing.gz"), env }),
    )
    assert.equal(env.FLAPSTACK_PROJECT_RECORDS_MODE, "standalone")
    assert.equal(projectRecordsEnabled(env), true)
    assert.equal(env.FLAPSTACK_PROJECT_RECORDS_URL, undefined)
    assert.match(projectRecordsStartupFailure(), /runtime is missing or unreadable/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("runtime archive cannot escape its extraction directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "flapstack-records-path-"))
  const snapshotPath = join(root, "runtime.gz")
  try {
    await writeFile(
      snapshotPath,
      gzipSync(JSON.stringify({ files: { "../../outside.py": "bad" } })),
    )
    await assert.rejects(
      startProjectRecordsRuntime({ userData: root, snapshotPath, env: {} }),
      /Invalid bundled Records runtime path/,
    )
    await assert.rejects(readFile(join(root, "outside.py")))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
