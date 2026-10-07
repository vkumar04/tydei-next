import { AuthCard } from "@/components/auth/auth-card"
import { SignUpForm } from "@/components/auth/sign-up-form"

export const instant = false

export default function SignUpPage() {
  return (
    <AuthCard
      title="Create an account"
      description="Get started with the contract management platform"
      showTermsFooter={false}
    >
      <SignUpForm />
    </AuthCard>
  )
}
