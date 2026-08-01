import { z } from "zod"

export const CHAT_TRANSFER_VERSION = 1 as const
export const CHAT_TRANSFER_DROP_ZONES = ["tab", "left", "right", "top", "bottom"] as const

const idSchema = z.string().trim().min(1).max(256)
const nonceSchema = z.string().min(12).max(256)

export const chatTransferStartSchema = z
  .object({
    version: z.literal(CHAT_TRANSFER_VERSION),
    chatId: idSchema,
    sourceWindowId: idSchema,
    sourceGroupId: idSchema,
    operation: z.enum(["move", "read-only-copy"]),
  })
  .strict()

export const chatTransferReserveSchema = z
  .object({
    version: z.literal(CHAT_TRANSFER_VERSION).optional(),
    nonce: nonceSchema,
    destinationWindowId: idSchema,
    destinationGroupId: idSchema,
    zone: z.enum(CHAT_TRANSFER_DROP_ZONES),
    reservationId: idSchema.optional(),
  })
  .strict()

export const chatTransferDestinationReadySchema = z
  .object({
    version: z.literal(CHAT_TRANSFER_VERSION),
    nonce: nonceSchema,
    destinationWindowId: idSchema,
  })
  .strict()

export const chatTransferCommitSchema = z
  .object({
    version: z.literal(CHAT_TRANSFER_VERSION),
    nonce: nonceSchema,
    windowId: idSchema,
  })
  .strict()

export const chatTransferOpenNewSchema = chatTransferStartSchema
  .extend({
    destinationGroupId: idSchema,
    zone: z.enum(CHAT_TRANSFER_DROP_ZONES),
    projectId: idSchema.optional(),
  })
  .strict()

export const chatTransferDropExistingSchema = chatTransferStartSchema
  .extend({
    destinationWindowId: idSchema,
    destinationGroupId: idSchema,
    zone: z.enum(CHAT_TRANSFER_DROP_ZONES),
  })
  .strict()

export const chatTransferDropOutsideSchema = chatTransferOpenNewSchema
  .extend({
    screenX: z.number().finite(),
    screenY: z.number().finite(),
  })
  .strict()

export type ChatTransferStart = z.infer<typeof chatTransferStartSchema>
export type ChatTransferReserve = z.infer<typeof chatTransferReserveSchema>
export type ChatTransferDestinationReady = z.infer<typeof chatTransferDestinationReadySchema>
export type ChatTransferCommit = z.infer<typeof chatTransferCommitSchema>
export type ChatTransferOpenNew = z.infer<typeof chatTransferOpenNewSchema>
export type ChatTransferDropExisting = z.infer<typeof chatTransferDropExistingSchema>
export type ChatTransferDropOutside = z.infer<typeof chatTransferDropOutsideSchema>

export interface ChatTransferToken {
  version: typeof CHAT_TRANSFER_VERSION
  nonce: string
  chatId: string
  sourceWindowId: string
  sourceGroupId: string
  operation: "move" | "read-only-copy"
  expiresAt: number
}

export interface ChatTransferDestination {
  windowId: string
  groupId: string
  zone: (typeof CHAT_TRANSFER_DROP_ZONES)[number]
}

export interface ChatTransferOffer {
  transfer: ChatTransferToken
  destination: ChatTransferDestination
}

export interface ChatTransferRemoveSource {
  version: typeof CHAT_TRANSFER_VERSION
  nonce: string
  sourceWindowId: string
  sourceGroupId: string
  chatId: string
}

export interface ChatTransferWindowDestination {
  stableId: string
  label: string
  state: "available" | "recovering"
  actions: readonly (
    "split-left" | "split-right" | "split-top" | "split-bottom" | "add-as-tab" | "focus" | "cancel"
  )[]
  groups?: readonly { id: string; label: string }[]
}

export type ChatTransferOpenNewResult =
  | { status: "offered"; nonce: string; destinationWindowId: string }
  | {
      status: "at-limit"
      destinations: ChatTransferWindowDestination[]
    }
  | { status: "ownership-conflict"; ownerWindowId: string | null }
  | { status: "creation-failed" | "reservation-expired" | "source-preserved" }

export function toChatTransferWindowDestinations(
  destinations: readonly {
    stableId: string
    label: string
    state: "available" | "recovering"
  }[],
): ChatTransferWindowDestination[] {
  return destinations.map((destination) => ({
    stableId: destination.stableId,
    label: destination.label,
    state: destination.state,
    actions:
      destination.state === "available"
        ? ([
            "split-left",
            "split-right",
            "split-top",
            "split-bottom",
            "add-as-tab",
            "focus",
            "cancel",
          ] as const)
        : (["focus", "cancel"] as const),
  }))
}

export type ChatTransferFailureStatus =
  "not-found" | "expired" | "replayed" | "invalid-phase" | "wrong-window"

export type ChatTransferStartResult =
  | { status: "started"; transfer: ChatTransferToken }
  | { status: "ownership-conflict"; ownerWindowId: string | null }

export type ChatTransferResult =
  | { status: ChatTransferFailureStatus }
  | { status: "reserved"; destination: ChatTransferDestination }
  | { status: "ready"; destination: ChatTransferDestination }
  | { status: "ownership-transferred" | "read-only" }
  | { status: "ownership-conflict"; ownerWindowId: string | null }
  | {
      status: "destination-committed"
      readOnly: boolean
      removeSource: { sourceWindowId: string; sourceGroupId: string; chatId: string } | null
    }
  | { status: "completed" }
  | { status: "rolled-back"; reason: string }
