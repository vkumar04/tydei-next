import Link from "next/link"
import { AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { AuthCard } from "@/components/auth/auth-card"

export default function AuthErrorPage() {
  return (
    <AuthCard title="Authentication Error">
      <div className="space-y-4 text-center">
        <AlertTriangle className="mx-auto size-10 text-destructive" />
        <p className="text-sm text-muted-foreground">
          Something went wrong during authentication. This could be an expired
          link, an invalid token, or a server issue.
        </p>
        <div className="flex flex-col gap-2">
          <Button asChild className="w-full">
            <Link href="/login">Try Again</Link>
          </Button>
          <Button variant="outline" asChild className="w-full">
            <Link href="/">Go Home</Link>
          </Button>
        </div>
      </div>
    </AuthCard>
  )
}
