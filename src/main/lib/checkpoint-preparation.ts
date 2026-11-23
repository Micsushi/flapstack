import {
  lstat,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises"
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path"

export type PreparedOriginals = {
  root: string
  profile: string
  lease: string
  dir: string
  keys: Set<string>
  stopped: boolean
  bytes: number
  deadline: number
  done: Promise<void>
  expiry?: NodeJS.Timeout
}

let selected: PreparedOriginals | undefined
let retiring = Promise.resolve()
const foreground = new Map<string, number>()
let lastSweptProfile: string | undefined
const marker = ".flapstack-checkpoint-preparation"
const marking = (dir: string) => "flapstack-checkpoint-preparation-v1\n" + basename(dir)

async function removePreparedDirectory(dir: string) {
  const physical = join(await realpath(dirname(dir)), basename(dir))
  if ((await realpath(dir)) !== physical || !(await lstat(dir)).isDirectory()) return
  const proof = join(dir, marker)
  const stat = await lstat(proof)
  if (
    !stat.isFile() ||
    stat.size !== Buffer.byteLength(marking(dir)) ||
    (await readFile(proof, "utf8")) !== marking(dir)
  )
    return
  const entries = await readdir(dir, { withFileTypes: true })
  const files = entries.filter((entry) => entry.name !== marker)
  if (
    files.some(
      (entry) => !entry.isFile() || !/^(?:[a-f0-9]{64}|[a-f0-9-]{36}\.partial)$/.test(entry.name),
    )
  )
    return
  for (let i = 0; i < files.length; i += 12)
    await Promise.all(files.slice(i, i + 12).map((entry) => unlink(join(dir, entry.name))))
  await unlink(proof)
  await rmdir(dir)
}

async function cleanup(dir: string) {
  for (const delay of [0, 150, 750]) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
    try {
      await removePreparedDirectory(dir)
      return
    } catch (error) {
      if (
        !["EPERM", "EBUSY", "EACCES", "ENOTEMPTY"].includes(
          (error as NodeJS.ErrnoException).code ?? "",
        )
      )
        return
    }
  }
}

function dispose(job: PreparedOriginals) {
  job.stopped = true
  clearTimeout(job.expiry)
  const removed = job.done.then(() => (job.dir ? cleanup(job.dir) : undefined)).catch(() => {})
  retiring = Promise.all([retiring, removed]).then(() => {})
}

function expire(job: PreparedOriginals, delay: number) {
  clearTimeout(job.expiry)
  job.expiry = setTimeout(() => {
    if (selected !== job) return
    selected = undefined
    dispose(job)
  }, delay)
  job.expiry.unref()
}

export async function sweepAbandonedCheckpointPreparations(profile: string) {
  if (lastSweptProfile === profile) return
  lastSweptProfile = profile
  for (const entry of await readdir(profile, { withFileTypes: true })) {
    const match = /^checkpoint-warm-(\d+)-[a-zA-Z0-9]{6}$/.exec(entry.name)
    if (!entry.isDirectory() || !match) continue
    try {
      process.kill(Number(match[1]), 0)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH")
        await cleanup(join(profile, entry.name))
    }
  }
}

export function releaseCheckpointPreparation(lease: string) {
  if (!selected || selected.lease !== lease) return
  const job = selected
  job.stopped = true
  // The new-chat form can unmount immediately before its first Send materializes the chat.
  expire(job, 1500)
}

export function selectCheckpointPreparation(
  root: string,
  profile: string,
  lease: string,
  prepare: (job: PreparedOriginals) => Promise<unknown>,
) {
  const inside = relative(root, profile)
  if (!inside || (!isAbsolute(inside) && inside !== ".." && !inside.startsWith(".." + sep))) return
  if (
    selected?.root === root &&
    selected.profile === profile &&
    (!selected.stopped || selected.keys.size)
  ) {
    selected.lease = lease
    expire(selected, 300000)
    return
  }
  if (selected) {
    const old = selected
    selected = undefined
    dispose(old)
  }
  if (foreground.has(root)) return
  const job: PreparedOriginals = {
    root,
    profile,
    lease,
    dir: "",
    keys: new Set(),
    stopped: false,
    bytes: 0,
    deadline: 0,
    done: Promise.resolve(),
  }
  selected = job
  const previous = retiring
  job.done = (async () => {
    await previous
    await new Promise((resolve) => setTimeout(resolve, 150))
    if (job.stopped || foreground.has(root)) return
    const physical = relative(root, await realpath(profile))
    if (
      !physical ||
      (!isAbsolute(physical) && physical !== ".." && !physical.startsWith(".." + sep))
    )
      return
    await sweepAbandonedCheckpointPreparations(profile)
    if (job.stopped) return
    job.dir = await mkdtemp(join(profile, "checkpoint-warm-" + process.pid + "-"))
    await writeFile(join(job.dir, marker), marking(job.dir), { flag: "wx", mode: 0o600 })
    job.deadline = Date.now() + 20_000
    await prepare(job)
  })().catch(() => {})
  expire(job, 300000)
}

export async function withPreparedOriginals<T>(
  root: string,
  profile: string,
  capture: (job?: PreparedOriginals) => Promise<T>,
) {
  foreground.set(root, (foreground.get(root) ?? 0) + 1)
  const job = selected?.root === root && selected.profile === profile ? selected : undefined
  if (job) {
    selected = undefined
    job.stopped = true
    clearTimeout(job.expiry)
  }
  try {
    // The foreground scan starts immediately. A shared per-file writer waits only
    // for an overlapping copy, then uses the completed, revalidated private bytes.
    return await capture(job)
  } finally {
    const count = foreground.get(root)! - 1
    if (count) foreground.set(root, count)
    else foreground.delete(root)
    if (job) dispose(job)
  }
}
