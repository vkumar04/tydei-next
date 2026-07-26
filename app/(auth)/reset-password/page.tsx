import { redirect } from "next/navigation"
import { AuthCard } from "@/components/auth/auth-card"
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
export default async function ResetPasswordPage({ searchParams }: ResetPasswordPageProps) {
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
