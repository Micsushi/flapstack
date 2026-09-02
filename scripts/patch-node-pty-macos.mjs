#!/usr/bin/env node

import { createRequire } from "node:module"
import { readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")

export function patchNodePtyMacosSource(source) {
  let patched = source

  patched = replaceOnce(
    patched,
    `      }
    }
#else
    while (true) {`,
    `      }
    }
    close(kq);
#else
    while (true) {`,
    "kqueue release",
  )

  patched = replaceDarwinPtySpawn(patched)

  patched = replaceOnce(
    patched,
    `  if (pty_nonblock(master) == -1) {
    throw Napi::Error::New(napiEnv, "Could not set master fd to nonblocking.");
  }`,
    `  if (pty_nonblock(master) == -1) {
    close(master);
    throw Napi::Error::New(napiEnv, "Could not set master fd to nonblocking.");
  }`,
    "master nonblocking failure cleanup",
  )

  return { source: patched, changed: patched !== source }
}

export function patchInstalledNodePty(options = {}) {
  if ((options.platform ?? process.platform) !== "darwin") return false

  const packageRoot = options.packageRoot ?? dirname(require.resolve("node-pty/package.json"))
  const packageVersion = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")).version
  if (packageVersion !== "1.1.0") {
    throw new Error(
      `Unsupported node-pty version for the macOS descriptor patch: ${packageVersion}`,
    )
  }

  const sourcePath = join(packageRoot, "src", "unix", "pty.cc")
  const source = readFileSync(sourcePath, "utf8")
  const patched = patchNodePtyMacosSource(source)
  if (!patched.changed) return false

  writeFileSync(sourcePath, patched.source)
  rmSync(join(packageRoot, "build", "Release", "pty.node"), { force: true })
  rmSync(options.nativeAbiMarkerPath ?? join(root, "node_modules", ".native-abi"), { force: true })
  return true
}

function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return source
  if (!source.includes(before)) {
    throw new Error(`Could not apply node-pty macOS ${label} patch.`)
  }
  return source.replace(before, after)
}

function replaceDarwinPtySpawn(source) {
  if (source.includes("bool spawn_succeeded = false;")) return source
  const startMarker = `#if defined(__APPLE__)
static void
pty_posix_spawn(`
  const start = source.indexOf(startMarker)
  const endMarker = `}
#endif`
  const end = source.indexOf(endMarker, start)
  if (start < 0 || end < 0) {
    throw new Error("Could not apply node-pty macOS PTY failure cleanup patch.")
  }
  const replacement = `#if defined(__APPLE__)
static void
pty_posix_spawn(char** argv, char** env,
                const struct termios *termp,
                const struct winsize *winp,
                int* master,
                pid_t* pid,
                int* err) {
  int low_fds[3] = { -1, -1, -1 };
  size_t low_fd_count = 0;
  int flags = POSIX_SPAWN_CLOEXEC_DEFAULT |
              POSIX_SPAWN_SETSIGDEF |
              POSIX_SPAWN_SETSIGMASK |
              POSIX_SPAWN_SETSID;
  int slave = -1;
  char slave_pty_name[128];
  posix_spawn_file_actions_t acts;
  posix_spawnattr_t attrs;
  sigset_t signal_set;
  bool acts_initialized = false;
  bool attrs_initialized = false;
  bool spawn_succeeded = false;

  *master = -1;
  *pid = -1;
  *err = -1;

  for (size_t count = 0; count < 3; count++) {
    int low_fd = posix_openpt(O_RDWR);
    if (low_fd == -1) {
      *err = errno == 0 ? EIO : errno;
      goto done;
    }
    low_fds[low_fd_count++] = low_fd;
    if (low_fd >= STDERR_FILENO)
      break;
  }

  *master = posix_openpt(O_RDWR);
  if (*master == -1) {
    *err = errno == 0 ? EIO : errno;
    goto done;
  }
  if (grantpt(*master) == -1 || unlockpt(*master) == -1) {
    *err = errno == 0 ? EIO : errno;
    goto done;
  }
  if (ioctl(*master, TIOCPTYGNAME, slave_pty_name) == -1) {
    *err = errno == 0 ? EIO : errno;
    goto done;
  }

  slave = open(slave_pty_name, O_RDWR | O_NOCTTY);
  if (slave == -1) {
    *err = errno == 0 ? EIO : errno;
    goto done;
  }
  if (termp && tcsetattr(slave, TCSANOW, termp) == -1) {
    *err = errno == 0 ? EIO : errno;
    goto done;
  }
  if (winp && ioctl(slave, TIOCSWINSZ, winp) == -1) {
    *err = errno == 0 ? EIO : errno;
    goto done;
  }

  *err = posix_spawn_file_actions_init(&acts);
  if (*err != 0)
    goto done;
  acts_initialized = true;
  *err = posix_spawn_file_actions_adddup2(&acts, slave, STDIN_FILENO);
  if (*err != 0)
    goto done;
  *err = posix_spawn_file_actions_adddup2(&acts, slave, STDOUT_FILENO);
  if (*err != 0)
    goto done;
  *err = posix_spawn_file_actions_adddup2(&acts, slave, STDERR_FILENO);
  if (*err != 0)
    goto done;
  *err = posix_spawn_file_actions_addclose(&acts, slave);
  if (*err != 0)
    goto done;
  *err = posix_spawn_file_actions_addclose(&acts, *master);
  if (*err != 0)
    goto done;

  *err = posix_spawnattr_init(&attrs);
  if (*err != 0)
    goto done;
  attrs_initialized = true;
  *err = posix_spawnattr_setflags(&attrs, flags);
  if (*err != 0)
    goto done;

  /* Reset all signals in the child to their default behavior. */
  sigfillset(&signal_set);
  *err = posix_spawnattr_setsigdefault(&attrs, &signal_set);
  if (*err != 0)
    goto done;

  /* Reset the signal mask for all signals. */
  sigemptyset(&signal_set);
  *err = posix_spawnattr_setsigmask(&attrs, &signal_set);
  if (*err != 0)
    goto done;

  do
    *err = posix_spawn(pid, argv[0], &acts, &attrs, argv, env);
  while (*err == EINTR);
  spawn_succeeded = *err == 0;

done:
  if (acts_initialized)
    posix_spawn_file_actions_destroy(&acts);
  if (attrs_initialized)
    posix_spawnattr_destroy(&attrs);
  if (slave >= 0)
    close(slave);
  for (size_t i = 0; i < low_fd_count; i++)
    close(low_fds[i]);
  if (!spawn_succeeded && *master >= 0) {
    close(*master);
    *master = -1;
  }
}
#endif`
  return `${source.slice(0, start)}${replacement}${source.slice(end + endMarker.length)}`
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const changed = patchInstalledNodePty()
  console.log(
    process.platform !== "darwin"
      ? "Skipped node-pty macOS descriptor patch on this platform."
      : changed
        ? "Patched node-pty macOS descriptor cleanup."
        : "node-pty macOS patch verified.",
  )
}
