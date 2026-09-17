import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Button,
} from "admin-frontend"

export function Open() {
  return (
    <Dialog defaultOpen>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Retire machine VM-104?</DialogTitle>
          <DialogDescription>
            This machine will stop appearing in the active fleet. Sales history is kept.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter showCloseButton>
          <Button variant="destructive">Retire machine</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function Simple() {
  return (
    <Dialog defaultOpen>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Restock complete</DialogTitle>
          <DialogDescription>All slots have been refilled and verified.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
