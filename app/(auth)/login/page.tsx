import Link from "next/link"
import { AuthCard } from "@/components/auth/auth-card"
import { LoginForm } from "@/components/auth/login-form"

export default function LoginPage() {
  return (
    <AuthCard
      title="Welcome back"
      description="Sign in to access your contract management dashboard"
      footer={
        <div className="text-center">
          <Link
            href="/admin"
            className="text-xs text-muted-foreground hover:text-primary transition-colors"
          >
            Operator/Admin Portal
          </Link>
        </div>
      }
    >
      <LoginForm />
    </AuthCard>
  )
}
