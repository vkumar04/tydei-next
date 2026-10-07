import { Suspense } from "react"
import { redirect } from "next/navigation"
import { AuthCard } from "@/components/auth/auth-card"
import { Skeleton } from "@/components/ui/skeleton"
import { ResetPasswordForm } from "@/components/auth/reset-password-form"

interface ResetPasswordPageProps {
  searchParams: Promise<{ token?: string; invite?: string }>
}

/**
 * Serves two flows off the same token, because better-auth mints one kind of
 * `reset-password:<token>` record and its endpoint creates the credential
 * account when none exists yet:
 *
 *   forgot password  -> "Reset your password"
 *   admin invite     -> "Set your password"  (?invite=1)
 *
 * Only the wording differs. Telling a brand-new user to "reset" a password
 * they have never had is the sort of small wrongness that makes people think
 * they have landed on the wrong page.
 */
async function ResetPasswordContent({ searchParams }: ResetPasswordPageProps) {
  const { token, invite } = await searchParams

  if (!token) {
    redirect("/login")
  }

  const isInvite = invite === "1"

  return (
    <AuthCard
      title={isInvite ? "Set your password" : "Reset Password"}
      description={
        isInvite
          ? "Choose a password to finish setting up your TYDEi account"
          : "Enter your new password below"
      }
    >
      <ResetPasswordForm token={token} />
    </AuthCard>
  )
}

export default function ResetPasswordPage({ searchParams }: ResetPasswordPageProps) {
  return (
    <Suspense
      fallback={
        <AuthCard title="Reset Password" description="Checking your link">
          <div className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        </AuthCard>
      }
    >
      <ResetPasswordContent searchParams={searchParams} />
    </Suspense>
  )
}
