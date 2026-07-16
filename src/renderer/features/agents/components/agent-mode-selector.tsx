"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu"
import {
  CheckIcon,
  EditIcon,
  EyeIcon,
  IconChevronDown,
  PlanIcon,
  SearchIcon,
} from "../../../components/ui/icons"
import { CHAT_MODES, CHAT_MODE_META, type ChatMode } from "../../../../shared/chat-mode"

const MODE_ICONS = {
  write: EditIcon,
  plan: PlanIcon,
  read: EyeIcon,
  review: SearchIcon,
} satisfies Record<ChatMode, typeof EditIcon>

export function AgentModeSelector({
  value,
  onChange,
  disabled = false,
}: {
  value: ChatMode
  onChange: (mode: ChatMode) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [tooltip, setTooltip] = useState<{
    position: { top: number; left: number }
    mode: ChatMode
  } | null>(null)
  const tooltipTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hasShownTooltipRef = useRef(false)

  const clearTooltip = useCallback(() => {
    if (tooltipTimeoutRef.current) clearTimeout(tooltipTimeoutRef.current)
    tooltipTimeoutRef.current = null
    setTooltip(null)
  }, [])

  useEffect(
    () => () => {
      if (tooltipTimeoutRef.current) clearTimeout(tooltipTimeoutRef.current)
    },
    [],
  )

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen)
      if (!nextOpen) {
        clearTooltip()
        hasShownTooltipRef.current = false
      }
    },
    [clearTooltip],
  )

  const handleMouseEnter = useCallback(
    (mode: ChatMode, element: HTMLElement) => {
      clearTooltip()
      const rect = element.getBoundingClientRect()
      const showTooltip = () => {
        setTooltip({
          position: { top: rect.top, left: rect.right + 8 },
          mode,
        })
        hasShownTooltipRef.current = true
        tooltipTimeoutRef.current = null
      }
      if (hasShownTooltipRef.current) showTooltip()
      else tooltipTimeoutRef.current = setTimeout(showTooltip, 1_000)
    },
    [clearTooltip],
  )

  const SelectedIcon = MODE_ICONS[value]

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Chat mode"
          disabled={disabled}
          className="flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground transition-[background-color,color] duration-150 ease-out hover:bg-muted/50 hover:text-foreground outline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring/70 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <SelectedIcon className="h-3 w-3 shrink-0" />
          <span>{CHAT_MODE_META[value].label}</span>
          <IconChevronDown className="h-2.5 w-2.5 shrink-0 opacity-50" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={6}
        className="!min-w-[116px] !w-[116px]"
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        {CHAT_MODES.map((mode) => {
          const Icon = MODE_ICONS[mode]
          return (
            <DropdownMenuItem
              key={mode}
              onSelect={() => {
                clearTooltip()
                onChange(mode)
                setOpen(false)
              }}
              onMouseEnter={(event) => handleMouseEnter(mode, event.currentTarget)}
              onMouseLeave={clearTooltip}
              className="justify-between gap-2"
            >
              <div className="flex items-center gap-2">
                <Icon className="h-4 w-4 text-muted-foreground" />
                <span>{CHAT_MODE_META[mode].label}</span>
              </div>
              {value === mode ? <CheckIcon className="ml-auto h-3.5 w-3.5 shrink-0" /> : null}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
      {tooltip
        ? createPortal(
            <div
              className="fixed z-[100000]"
              style={{
                top: tooltip.position.top + 14,
                left: tooltip.position.left,
                transform: "translateY(-50%)",
              }}
            >
              <div className="relative max-w-[150px] rounded-[12px] bg-popover px-2.5 py-1.5 text-xs text-popover-foreground dark">
                {CHAT_MODE_META[tooltip.mode].description}
              </div>
            </div>,
            document.body,
          )
        : null}
    </DropdownMenu>
  )
}
