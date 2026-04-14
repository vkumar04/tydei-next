import { AuthCard } from "@/components/auth/auth-card"
import { SignUpForm } from "@/components/auth/sign-up-form"

export default function SignUpPage() {
  return (
    <AuthCard
      title="Create an account"
      description="Get started with the contract management platform"
    >
      <SignUpForm />
    </AuthCard>
  )
}
