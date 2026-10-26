import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
  AlertDialogAction,
} from "../../../ui/alert-dialog"

interface DeleteServerConfirmProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  serverName: string
  onConfirm: () => void
  isDeleting?: boolean
  error?: string | null
}

export function DeleteServerConfirm({
  open,
  onOpenChange,
  serverName,
  onConfirm,
  isDeleting = false,
  error,
}: DeleteServerConfirmProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete MCP Server</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete <strong>{serverName}</strong>? This will remove the
            server configuration. You can use Undo while this app session remains open.
          </AlertDialogDescription>
          {error && (
            <p role="alert" className="text-sm text-destructive break-words">
              {error}
            </p>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault()
              onConfirm()
            }}
            disabled={isDeleting}
            className="bg-red-600 hover:bg-red-700 text-white"
          >
            {isDeleting ? "Deleting..." : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
