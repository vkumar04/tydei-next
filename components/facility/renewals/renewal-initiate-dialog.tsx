"use client"

import { useTransition } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { RefreshCw } from "lucide-react"

interface RenewalInitiateDialogProps {
  contractName: string
  vendorName: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onInitiate: () => Promise<void>
}

export function RenewalInitiateDialog({
  contractName,
  vendorName,
  open,
  onOpenChange,
  onInitiate,
}: RenewalInitiateDialogProps) {
  const [isPending, startTransition] = useTransition()

  function handleInitiate() {
    startTransition(async () => {
      await onInitiate()
      onOpenChange(false)
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Initiate Renewal</DialogTitle>
          <DialogDescription>
            This will create a draft copy of <strong>{contractName}</strong> with{" "}
            <strong>{vendorName}</strong> with new dates starting from the current
            expiration date.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={handleInitiate} disabled={isPending}>
            <RefreshCw className="mr-1.5 size-4" />
            {isPending ? "Creating..." : "Create Renewal Draft"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
