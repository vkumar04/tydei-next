import { AuthCard } from "@/components/auth/auth-card"
import { LoginForm } from "@/components/auth/login-form"

export default function LoginPage() {
  return (
    <AuthCard
      title="Sign In"
      description="Enter your credentials to access your portal"
    >
      <LoginForm />
    </AuthCard>
  )
}
