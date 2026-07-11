/** Per-window speech authority. Requests in one Electron window never cancel
 * or invalidate synthesis requested by another window. */
export class SpeechRequestOwnership {
  private readonly requestIds = new Map<number, number>()

  begin(windowId: number): number {
    const requestId = (this.requestIds.get(windowId) ?? 0) + 1
    this.requestIds.set(windowId, requestId)
    return requestId
  }

  cancel(windowId: number): void {
    this.requestIds.set(windowId, (this.requestIds.get(windowId) ?? 0) + 1)
  }

  isActive(windowId: number, requestId: number): boolean {
    return this.requestIds.get(windowId) === requestId
  }
}
