import { ListPlus } from "lucide-react"
import type { SpeechVocabularyTerm } from "../../../../shared/speech-vocabulary"
import { Button } from "../../../components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "../../../components/ui/popover"

export function SpeechVocabularyPopover({ terms }: { terms: readonly SpeechVocabularyTerm[] }) {
  if (terms.length === 0) return null
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 rounded-sm"
          aria-label={`Inspect dictation vocabulary, ${terms.length} selected context terms`}
        >
          <ListPlus className="h-4 w-4" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        forceDark={false}
        className="w-[min(20rem,calc(100vw-2rem))] p-4"
        aria-label="Selected dictation vocabulary"
      >
        <p className="text-sm font-semibold">Selected-context vocabulary</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          Supported local engines receive only these terms. Cloud speech receives none without
          explicit selected-context consent. Dictation always stays editable before send.
        </p>
        <ul className="mt-3 space-y-1.5 text-xs">
          {terms.map((term) => (
            <li key={`${term.source}:${term.value}`} className="flex items-center gap-2">
              <span className="w-12 shrink-0 capitalize text-muted-foreground">{term.source}</span>
              <span className="min-w-0 truncate font-medium">{term.value}</span>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
