import { AuthCard } from "@/components/auth/auth-card"
import { SignUpForm } from "@/components/auth/sign-up-form"

export default function SignUpPage() {
  return (
    <AuthCard
      title="Create Account"
      description="Get started with TYDEi for your organization"
    >
      <SignUpForm />
    </AuthCard>
  )
}
