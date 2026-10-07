import { AuthCard } from "@/components/auth/auth-card"
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form"

export const ensureStatic = "navigation"

export default function ForgotPasswordPage() {
  return (
    <AuthCard
      title="Forgot Password"
      description="Enter your email to receive a password reset link"
    >
      <ForgotPasswordForm />
    </AuthCard>
  )
}
