import { createContext } from "react"
export const MessageReplyContext = createContext<
  ((message: { id: string; role: "user" | "assistant"; text: string }) => void) | null
>(null)
