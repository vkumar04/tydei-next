import Link from "next/link"
import { MailCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { AuthCard } from "@/components/auth/auth-card"

export default function SignUpSuccessPage() {
  return (
    <AuthCard title="Check Your Email">
      <div className="space-y-4 text-center">
        <MailCheck className="mx-auto size-10 text-primary" />
        <p className="text-sm text-muted-foreground">
          We&apos;ve sent a verification link to your email address. Click the
          link to activate your account.
        </p>
        <Button variant="outline" asChild className="w-full">
          <Link href="/login">Back to Sign In</Link>
        </Button>
      </div>
    </AuthCard>
  )
}
