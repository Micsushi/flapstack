"use client"

import {
  Children,
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { MoreHorizontal } from "lucide-react"

import { Button } from "./ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "./ui/dropdown-menu"
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover"
import { cn } from "../lib/utils"

type ProgressiveOverflowCalculation = {
  containerWidth: number
  itemWidths: number[]
  usageRatio: number
  gap: number
  overflowWidth: number
  reservedWidth?: number
  reservedItemCount?: number
  collapseOrder?: number[]
}

export function resolveProgressiveVisibleIndexes({
  containerWidth,
  itemWidths,
  usageRatio,
  gap,
  overflowWidth,
  reservedWidth = 0,
  reservedItemCount = reservedWidth > 0 ? 1 : 0,
  collapseOrder,
}: ProgressiveOverflowCalculation): number[] {
  const softBudget = Math.max(0, containerWidth * usageRatio)
  const defaultCollapseOrder = itemWidths.map((_, index) => index).reverse()
  const orderedIndexes = [...(collapseOrder ?? []), ...defaultCollapseOrder].filter(
    (index, position, indexes) =>
      index >= 0 && index < itemWidths.length && indexes.indexOf(index) === position,
  )
  const visibleIndexes = itemWidths.map((_, index) => index)

  const fits = () => {
    const visibleWidth = visibleIndexes.reduce((total, index) => total + itemWidths[index], 0)
    const visibleGaps = Math.max(0, visibleIndexes.length - 1) * gap
    const originalControlsWidth = visibleWidth + visibleGaps
    const hasOverflow = visibleIndexes.length < itemWidths.length
    const renderedItemCount = visibleIndexes.length + reservedItemCount + (hasOverflow ? 1 : 0)
    const fixedGapCount =
      Math.max(0, renderedItemCount - 1) - Math.max(0, visibleIndexes.length - 1)
    const fixedWidth = reservedWidth + (hasOverflow ? overflowWidth : 0) + fixedGapCount * gap
    const hardBudget = Math.max(0, containerWidth - fixedWidth)
    return originalControlsWidth <= Math.min(softBudget, hardBudget)
  }

  for (const index of orderedIndexes) {
    if (fits()) break
    visibleIndexes.splice(visibleIndexes.indexOf(index), 1)
  }

  return visibleIndexes
}

export function resolveProgressiveVisibleCount(
  calculation: ProgressiveOverflowCalculation,
): number {
  return resolveProgressiveVisibleIndexes(calculation).length
}

type ProgressiveOverflowRowProps = {
  children: ReactNode
  usageRatio: number
  menuLabel: string
  className?: string
  contentClassName?: string
  gap?: number
  overflowWidth?: number
  pinnedStart?: ReactNode
  pinnedEnd?: ReactNode
  align?: "start" | "center" | "end"
  side?: "top" | "right" | "bottom" | "left"
  style?: CSSProperties
  collapseOrder?: number[]
  onHiddenIndexesChange?: (indexes: number[]) => void
  onContentWidthChange?: (width: number) => void
  forceOverflow?: boolean
  overflowLabels?: string[]
  overflowLayout?: "wrap" | "rows"
}

export function ProgressiveOverflowRow({
  children,
  usageRatio,
  menuLabel,
  className,
  contentClassName,
  gap = 4,
  overflowWidth = 28,
  pinnedStart,
  pinnedEnd,
  align = "end",
  side = "bottom",
  style,
  collapseOrder,
  onHiddenIndexesChange,
  onContentWidthChange,
  forceOverflow = false,
  overflowLabels,
  overflowLayout = "wrap",
}: ProgressiveOverflowRowProps) {
  const items = Children.toArray(children).filter(Boolean)
  const itemKeys = items.map((item, index) =>
    typeof item === "object" && item !== null && "key" in item
      ? String(item.key ?? index)
      : String(index),
  )
  const itemSignature = itemKeys.join("|")
  const hasPinnedStart = Boolean(pinnedStart)
  const hasPinnedEnd = Boolean(pinnedEnd)
  const collapseOrderSignature = (collapseOrder ?? []).join(",")
  const stableCollapseOrder = useMemo(
    () =>
      collapseOrderSignature
        ? collapseOrderSignature.split(",").map((index) => Number(index))
        : undefined,
    [collapseOrderSignature],
  )
  const rowRef = useRef<HTMLDivElement>(null)
  const itemWidthsRef = useRef<number[]>([])
  const measureFrameRef = useRef<number | null>(null)
  const [visibleIndexes, setVisibleIndexes] = useState(() =>
    forceOverflow ? [] : items.map((_, index) => index),
  )
  const visibleSignature = visibleIndexes.join(",")

  const measure = useCallback(() => {
    const row = rowRef.current
    if (!row) return
    if (forceOverflow) {
      setVisibleIndexes([])
      return
    }
    row.querySelectorAll<HTMLElement>("[data-progressive-overflow-item]").forEach((element) => {
      const index = Number(element.dataset.progressiveOverflowItem)
      if (Number.isInteger(index))
        itemWidthsRef.current[index] = element.getBoundingClientRect().width
    })
    const pinnedItems = Array.from(
      row.querySelectorAll<HTMLElement>("[data-progressive-overflow-pinned]"),
    )
    const pinnedWidth = pinnedItems.reduce(
      (total, item) => total + item.getBoundingClientRect().width,
      0,
    )
    const widths = Array.from(
      { length: items.length },
      (_, index) => itemWidthsRef.current[index] ?? 0,
    )
    if (widths.some((width) => width <= 0)) return
    onContentWidthChange?.(
      widths.reduce((total, width) => total + width, 0) + Math.max(0, widths.length - 1) * gap,
    )
    const nextVisibleIndexes = resolveProgressiveVisibleIndexes({
      containerWidth: row.getBoundingClientRect().width,
      itemWidths: widths,
      usageRatio,
      gap,
      overflowWidth,
      reservedWidth: pinnedWidth,
      reservedItemCount: pinnedItems.length,
      collapseOrder: stableCollapseOrder,
    })
    setVisibleIndexes((current) =>
      current.length === nextVisibleIndexes.length &&
      current.every((index, position) => index === nextVisibleIndexes[position])
        ? current
        : nextVisibleIndexes,
    )
  }, [
    forceOverflow,
    gap,
    itemSignature,
    items.length,
    overflowWidth,
    onContentWidthChange,
    stableCollapseOrder,
    usageRatio,
  ])

  const scheduleMeasure = useCallback(() => {
    if (measureFrameRef.current !== null) return
    measureFrameRef.current = requestAnimationFrame(() => {
      measureFrameRef.current = null
      measure()
    })
  }, [measure])

  useLayoutEffect(() => {
    itemWidthsRef.current = []
    setVisibleIndexes(forceOverflow ? [] : items.map((_, index) => index))
  }, [forceOverflow, itemSignature, items.length])

  useLayoutEffect(() => {
    const row = rowRef.current
    if (!row) return
    scheduleMeasure()
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(scheduleMeasure)
    observer.observe(row)
    // Inline items must be observed individually: a label whose text changes
    // without any container resize still changes how much room the row needs.
    // Measurement stays batched into one animation frame, so re-observing the
    // items after a visibility change settles instead of looping.
    row
      .querySelectorAll("[data-progressive-overflow-item],[data-progressive-overflow-pinned]")
      .forEach((element) => observer.observe(element))
    return () => {
      observer.disconnect()
      if (measureFrameRef.current !== null) cancelAnimationFrame(measureFrameRef.current)
      measureFrameRef.current = null
    }
  }, [hasPinnedEnd, hasPinnedStart, itemSignature, scheduleMeasure, visibleSignature])

  const visibleIndexSet = new Set(visibleIndexes)
  const visibleItems = items
    .map((item, index) => ({ item, index }))
    .filter(({ index }) => visibleIndexSet.has(index))
  const overflowItems = items
    .map((item, index) => ({ item, index }))
    .filter(({ index }) => !visibleIndexSet.has(index))
  const hiddenIndexesSignature = overflowItems.map(({ index }) => index).join(",")

  useEffect(() => {
    onHiddenIndexesChange?.(overflowItems.map(({ index }) => index))
  }, [hiddenIndexesSignature, onHiddenIndexesChange])

  return (
    <div
      ref={rowRef}
      className={cn("flex min-w-0 items-center", className)}
      style={{ ...style, columnGap: gap }}
      data-progressive-overflow-row
    >
      {pinnedStart && (
        <div
          className="flex shrink-0 items-center"
          data-progressive-overflow-pinned
          data-progressive-overflow-pinned-start
        >
          {pinnedStart}
        </div>
      )}
      {visibleItems.map(({ item, index }) => (
        <div
          key={`inline-${itemKeys[index]}`}
          className="flex shrink-0 items-center"
          data-progressive-overflow-item={index}
        >
          {item}
        </div>
      ))}
      {overflowItems.length > 0 && overflowLayout === "rows" && (
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 rounded-sm"
              aria-label={menuLabel}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            align={align}
            side={side}
            sideOffset={6}
            className="w-[min(24rem,calc(100vw-1rem))] p-1.5"
            onFocusOutside={(event) => event.preventDefault()}
          >
            <div className="divide-y divide-border/60">
              {overflowItems.map(({ item, index }) => (
                <div
                  key={`overflow-${itemKeys[index]}`}
                  className="grid min-h-10 grid-cols-[88px_minmax(0,1fr)] items-center gap-3 px-2 py-1.5"
                >
                  <span className="text-xs font-medium text-muted-foreground">
                    {overflowLabels?.[index] ?? "Setting"}
                  </span>
                  <div className="flex min-w-0 justify-end">{item}</div>
                </div>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      )}
      {overflowItems.length > 0 && overflowLayout === "wrap" && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 rounded-sm"
              aria-label={menuLabel}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align={align} side={side} className="min-w-52 p-2">
            <div className={cn("flex max-w-72 flex-wrap items-center gap-2", contentClassName)}>
              {overflowItems.map(({ item, index }) => (
                <div key={`overflow-${itemKeys[index]}`} className="flex items-center">
                  {item}
                </div>
              ))}
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {pinnedEnd && (
        <div className="flex shrink-0 items-center" data-progressive-overflow-pinned>
          {pinnedEnd}
        </div>
      )}
    </div>
  )
}
