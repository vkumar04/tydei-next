"use client"

import { useState } from "react"
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
  const [loading, setLoading] = useState(false)

  async function handleInitiate() {
    setLoading(true)
    try {
      await onInitiate()
      onOpenChange(false)
    } finally {
      setLoading(false)
    }
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
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleInitiate} disabled={loading}>
            <RefreshCw className="mr-1.5 size-4" />
            {loading ? "Creating..." : "Create Renewal Draft"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
