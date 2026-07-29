import { describe, expect, it } from "vitest"
import {
  PRODUCT_TOUR_STORAGE_KEY,
  PRODUCT_TOUR_VERSION,
  readProductTourState,
  shouldAutoStartProductTour,
  writeProductTourState,
} from "../src/shared/product-tour"

class MemoryStorage {
  values = new Map<string, string>()
  getItem(key: string) {
    return this.values.get(key) ?? null
  }
  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
}

describe("product tour state", () => {
  it("auto-starts only an unfinished packaged profile", () => {
    expect(shouldAutoStartProductTour({ isPackaged: true, state: null })).toBe(true)
    expect(shouldAutoStartProductTour({ isPackaged: false, state: null })).toBe(false)
    expect(
      shouldAutoStartProductTour({
        isPackaged: true,
        state: { version: PRODUCT_TOUR_VERSION, status: "completed" },
      }),
    ).toBe(false)
  })

  it("persists completion and dismissal for the current version", () => {
    const storage = new MemoryStorage()
    writeProductTourState(storage, "dismissed")
    expect(storage.values.has(PRODUCT_TOUR_STORAGE_KEY)).toBe(true)
    expect(readProductTourState(storage)).toEqual({
      version: PRODUCT_TOUR_VERSION,
      status: "dismissed",
    })
  })
})
