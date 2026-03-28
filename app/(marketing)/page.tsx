import Link from "next/link"
import { Button } from "@/components/ui/button"

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6">
      <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-primary">
        <span className="text-2xl font-bold text-primary-foreground">T</span>
      </div>
      <h1 className="text-4xl font-bold">TYDEi Platform</h1>
      <p className="text-muted-foreground">
        Healthcare contract management — coming soon
      </p>
      <div className="flex gap-3">
        <Button asChild>
          <Link href="/login">Sign In</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/sign-up">Get Started</Link>
        </Button>
      </div>
    </div>
  )
}
