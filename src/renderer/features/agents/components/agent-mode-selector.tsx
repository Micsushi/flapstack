"use client"

import { useCallback, useState } from "react"
import { cn } from "../../../lib/utils"
import { CHAT_MODES, CHAT_MODE_META, type ChatMode } from "../../../../shared/chat-mode"

export function AgentModeSelector({
  value,
  onChange,
  disabled = false,
}: {
  value: ChatMode
  onChange: (mode: ChatMode) => void
  disabled?: boolean
}) {
  const [dragging, setDragging] = useState(false)
  const selectedIndex = Math.max(0, CHAT_MODES.indexOf(value))

  const selectFromPointer = useCallback(
    (clientX: number, element: HTMLElement) => {
      if (disabled) return
      const rect = element.getBoundingClientRect()
      if (rect.width <= 0) return
      const index = Math.min(
        CHAT_MODES.length - 1,
        Math.max(0, Math.floor(((clientX - rect.left) / rect.width) * CHAT_MODES.length)),
      )
      const next = CHAT_MODES[index]
      if (next !== value) onChange(next)
    },
    [disabled, onChange, value],
  )

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (disabled) return
      let nextIndex = selectedIndex
      if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex++
      else if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex--
      else if (event.key === "Home") nextIndex = 0
      else if (event.key === "End") nextIndex = CHAT_MODES.length - 1
      else return
      event.preventDefault()
      onChange(CHAT_MODES[(nextIndex + CHAT_MODES.length) % CHAT_MODES.length])
    },
    [disabled, onChange, selectedIndex],
  )

  return (
    <div
      role="radiogroup"
      data-tour="mode"
      aria-label="Chat mode"
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : 0}
      onKeyDown={handleKeyDown}
      onPointerDown={(event) => {
        if (disabled) return
        setDragging(true)
        event.currentTarget.setPointerCapture?.(event.pointerId)
        selectFromPointer(event.clientX, event.currentTarget)
      }}
      onPointerMove={(event) => {
        if (dragging) selectFromPointer(event.clientX, event.currentTarget)
      }}
      onPointerUp={(event) => {
        setDragging(false)
        event.currentTarget.releasePointerCapture?.(event.pointerId)
      }}
      onPointerCancel={() => setDragging(false)}
      className={cn(
        "relative grid h-7 w-[174px] grid-cols-3 rounded-md border border-border/70 bg-muted/35 p-0.5",
        "outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring/70",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute bottom-0.5 top-0.5 rounded-[4px] bg-background shadow-sm transition-transform duration-150 ease-out motion-reduce:transition-none"
        style={{
          width: "calc((100% - 4px) / 3)",
          transform: `translateX(calc(${selectedIndex * 100}% + ${selectedIndex}px))`,
        }}
      />
      {CHAT_MODES.map((mode) => (
        <button
          key={mode}
          type="button"
          role="radio"
          aria-checked={value === mode}
          aria-label={CHAT_MODE_META[mode].label}
          title={CHAT_MODE_META[mode].description}
          disabled={disabled}
          tabIndex={-1}
          onClick={() => onChange(mode)}
          className={cn(
            "relative z-10 rounded-[4px] px-2 text-xs font-medium transition-colors duration-150 ease-out",
            value === mode ? "text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          <span>{CHAT_MODE_META[mode].label}</span>
        </button>
      ))}
    </div>
  )
}
