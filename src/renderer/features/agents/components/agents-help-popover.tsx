"use client"

import { useState } from "react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu"
import { ArrowUpRight } from "lucide-react"
import { KeyboardIcon } from "../../../components/ui/icons"
import { useSetAtom } from "jotai"
import { agentsSettingsDialogOpenAtom, agentsSettingsDialogActiveTabAtom } from "../../../lib/atoms"

interface AgentsHelpPopoverProps {
  children: React.ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
  isMobile?: boolean
}

export function AgentsHelpPopover({
  children,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  isMobile = false,
}: AgentsHelpPopoverProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const setSettingsDialogOpen = useSetAtom(agentsSettingsDialogOpenAtom)
  const setSettingsActiveTab = useSetAtom(agentsSettingsDialogActiveTabAtom)

  const open = controlledOpen ?? internalOpen
  const setOpen = controlledOnOpenChange ?? setInternalOpen

  const handleWebsiteClick = () => {
    window.desktopApi.openExternal("https://flapstack.dev")
  }

  const handleChangelogClick = () => {
    window.desktopApi.openExternal("https://flapstack.dev/agents/changelog")
  }

  const handleKeyboardShortcutsClick = () => {
    setOpen(false)
    setSettingsActiveTab("keyboard")
    setSettingsDialogOpen(true)
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-56">
        <DropdownMenuItem onClick={handleWebsiteClick} className="gap-2">
          <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="flex-1">Website</span>
        </DropdownMenuItem>

        {!isMobile && (
          <DropdownMenuItem onClick={handleKeyboardShortcutsClick} className="gap-2">
            <KeyboardIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="flex-1">Shortcuts</span>
          </DropdownMenuItem>
        )}

        <DropdownMenuItem onClick={handleChangelogClick} className="gap-2">
          <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="flex-1">Changelog</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
