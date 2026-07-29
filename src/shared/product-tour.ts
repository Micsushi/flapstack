export const PRODUCT_TOUR_VERSION = 1
export const PRODUCT_TOUR_STORAGE_KEY = `flapstack:product-tour:v${PRODUCT_TOUR_VERSION}`

export type ProductTourStatus = "completed" | "dismissed"

export interface ProductTourState {
  version: number
  status: ProductTourStatus
}

export interface ProductTourStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export function readProductTourState(storage: ProductTourStorage): ProductTourState | null {
  try {
    const value = JSON.parse(storage.getItem(PRODUCT_TOUR_STORAGE_KEY) ?? "null") as unknown
    if (!value || typeof value !== "object") return null
    const candidate = value as Partial<ProductTourState>
    if (!Number.isInteger(candidate.version)) return null
    if (candidate.status !== "completed" && candidate.status !== "dismissed") return null
    return { version: candidate.version!, status: candidate.status }
  } catch {
    return null
  }
}

export function shouldAutoStartProductTour(input: {
  isPackaged: boolean
  state: ProductTourState | null
}): boolean {
  if (!input.isPackaged) return false
  return input.state?.version !== PRODUCT_TOUR_VERSION
}

export function writeProductTourState(
  storage: ProductTourStorage,
  status: ProductTourStatus,
): void {
  storage.setItem(
    PRODUCT_TOUR_STORAGE_KEY,
    JSON.stringify({ version: PRODUCT_TOUR_VERSION, status }),
  )
}
