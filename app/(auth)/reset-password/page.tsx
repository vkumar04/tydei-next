import { redirect } from "next/navigation"
import { AuthCard } from "@/components/auth/auth-card"
import { ResetPasswordForm } from "@/components/auth/reset-password-form"

interface ResetPasswordPageProps {
  searchParams: Promise<{ token?: string }>
}

export default async function ResetPasswordPage({ searchParams }: ResetPasswordPageProps) {
  const { token } = await searchParams

  if (!token) {
    redirect("/login")
  }

  return (
    <AuthCard
      title="Reset Password"
      description="Enter your new password below"
    >
      <ResetPasswordForm token={token} />
    </AuthCard>
  )
}
