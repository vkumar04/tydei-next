"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { authClient } from "@/lib/auth"

interface AcceptInvitationFormProps {
  invitationId: string
  organizationName: string
  role: string
}

/**
 * Accept / decline controls for an organization invitation.
 *
 * Runs client-side because better-auth's accept + reject endpoints need the
 * session cookie on the request; the server component upstream has already
 * confirmed the caller is signed in as the invited address.
 */
export function AcceptInvitationForm({
  invitationId,
  organizationName,
  role,
}: AcceptInvitationFormProps) {
  const router = useRouter()
  const [isAccepting, startAccept] = useTransition()
  const [isDeclining, startDecline] = useTransition()

  // Vendor roles are stored colon-concatenated ("admin:owner") — show the
  // base segment, matching how the invite email labels it.
  const roleLabel = (() => {
    const base = role?.split(":")[0]?.trim()
    return base ? base.charAt(0).toUpperCase() + base.slice(1) : null
  })()

  function handleAccept() {
    startAccept(async () => {
      const { error } = await authClient.organization.acceptInvitation({
        invitationId,
      })
      if (error) {
        toast.error(error.message || "Could not accept this invitation.")
        return
      }
      toast.success(`You've joined ${organizationName}.`)
      router.push("/dashboard")
      router.refresh()
    })
  }

  function handleDecline() {
    startDecline(async () => {
      const { error } = await authClient.organization.rejectInvitation({
        invitationId,
      })
      if (error) {
        toast.error(error.message || "Could not decline this invitation.")
        return
      }
      toast.success("Invitation declined.")
      router.push("/login")
    })
  }

  const busy = isAccepting || isDeclining

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Accepting adds your account to{" "}
        <span className="font-medium text-foreground">{organizationName}</span>
        {roleLabel ? (
          <>
            {" "}
            as <span className="font-medium text-foreground">{roleLabel}</span>
          </>
        ) : null}
        .
      </p>

      <Button className="w-full" onClick={handleAccept} disabled={busy}>
        {isAccepting && <Loader2 className="mr-2 size-4 animate-spin" />}
        Accept invitation
      </Button>

      <Button
        variant="outline"
        className="w-full"
        onClick={handleDecline}
        disabled={busy}
      >
        {isDeclining && <Loader2 className="mr-2 size-4 animate-spin" />}
        Decline
      </Button>

      <p className="text-center text-xs text-muted-foreground">
        Not expecting this?{" "}
        <Link href="/dashboard" className="underline">
          Skip for now
        </Link>
      </p>
    </div>
  )
}
