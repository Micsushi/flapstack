import type { ChildProcess } from "node:child_process"

/** execFile may reject on abort before close; retain ownership until handles close. */
export async function afterProcessClose<T>(
  execution: Promise<T> & { child: ChildProcess },
): Promise<T> {
  const closed = new Promise<void>((resolve) => execution.child.once("close", () => resolve()))
  try {
    return await execution
  } finally {
    await closed
  }
}
