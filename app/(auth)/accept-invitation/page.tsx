import { headers } from "next/headers"
import Link from "next/link"
import { redirect } from "next/navigation"

import { AuthCard } from "@/components/auth/auth-card"
import { AcceptInvitationForm } from "@/components/auth/accept-invitation-form"
import { Button } from "@/components/ui/button"
import { auth } from "@/lib/auth-server"

/**
 * Landing page for the invitation email's "Accept invitation" button.
 *
 * Until 2026-07-26 this route did not exist, so every invitation link 404'd.
 * The invite mail points here as `/accept-invitation?id=<invitationId>`.
 *
 * Four states are handled explicitly:
 *   - no/blank id            → generic invalid message
 *   - signed out             → bounce to /login with a callbackUrl back here,
 *                              so the user returns to this page after auth
 *   - signed in, wrong user  → tell them which address the invite is for
 *                              rather than silently failing on accept
 *   - signed in, right user  → show org + role, accept on click
 *
 * The accept itself is a client action (better-auth needs session cookies),
 * so this server component only resolves state and hands off.
 */
export default async function AcceptInvitationPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>
}) {
  const { id } = await searchParams

  if (!id) {
    return (
      <AuthCard
        title="Invalid invitation"
        description="This invitation link is missing its identifier."
      >
        <p className="text-sm text-muted-foreground">
          Ask whoever invited you to send a fresh invitation.
        </p>
      </AuthCard>
    )
  }

  const requestHeaders = await headers()
  const session = await auth.api.getSession({ headers: requestHeaders })

  if (!session) {
    // Come back here after signing in. `callbackUrl` is the same param the
    // proxy uses for protected pages.
    redirect(
      `/login?callbackUrl=${encodeURIComponent(`/accept-invitation?id=${id}`)}`,
    )
  }

  // The invitation lookup is session-scoped by better-auth; an id belonging
  // to someone else surfaces here as an error rather than leaking details.
  let invitation: Awaited<ReturnType<typeof auth.api.getInvitation>> | null = null
  let lookupFailed = false
  try {
    invitation = await auth.api.getInvitation({
      query: { id },
      headers: requestHeaders,
    })
  } catch {
    lookupFailed = true
  }

  if (lookupFailed || !invitation) {
    return (
      <AuthCard
        title="Invitation unavailable"
        description="This invitation can't be opened."
      >
        <p className="text-sm text-muted-foreground">
          It may have expired, already been accepted, or been sent to a
          different address. Invitations are valid for 7 days — ask for a new
          one if yours has lapsed.
        </p>
        <Button asChild variant="outline" className="mt-4 w-full">
          <Link href="/dashboard">Go to dashboard</Link>
        </Button>
      </AuthCard>
    )
  }

  const invitedEmail = invitation.email?.toLowerCase()
  const signedInEmail = session.user.email?.toLowerCase()

  if (invitedEmail && signedInEmail && invitedEmail !== signedInEmail) {
    return (
      <AuthCard
        title="Wrong account"
        description="This invitation is for a different email address."
      >
        <p className="text-sm text-muted-foreground">
          You&apos;re signed in as{" "}
          <span className="font-medium text-foreground">{session.user.email}</span>
          , but this invitation was sent to{" "}
          <span className="font-medium text-foreground">{invitation.email}</span>.
          Sign out and sign back in with that address to accept it.
        </p>
        <Button asChild variant="outline" className="mt-4 w-full">
          <Link href="/dashboard">Go to dashboard</Link>
        </Button>
      </AuthCard>
    )
  }

  return (
    <AuthCard
      title="Accept invitation"
      description={`You've been invited to join ${invitation.organizationName ?? "an organization"}.`}
    >
      <AcceptInvitationForm
        invitationId={id}
        organizationName={invitation.organizationName ?? "this organization"}
        role={invitation.role}
      />
    </AuthCard>
  )
}
