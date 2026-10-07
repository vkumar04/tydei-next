import Link from "next/link"
import { AuthCard } from "@/components/auth/auth-card"
import { LoginForm } from "@/components/auth/login-form"
import { DEMO_LOGIN_ACCOUNTS, demoLoginsEnabled } from "@/lib/auth/demo-accounts"

export default function LoginPage() {
  // Server-side gate: when demo logins are disabled the accounts (and their
  // credentials) are never passed down, so nothing ships to the browser.
  // Flip with SHOW_DEMO_LOGINS (server env var, not NEXT_PUBLIC).
  const demoAccounts = demoLoginsEnabled() ? [...DEMO_LOGIN_ACCOUNTS] : null

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
      <LoginForm demoAccounts={demoAccounts} />
    </AuthCard>
  )
}
