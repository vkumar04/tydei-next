import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { Button } from "@/components/ui/button"

export function CtaSection() {
  return (
    <section className="px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
      <div className="mx-auto max-w-4xl overflow-hidden rounded-2xl bg-gradient-to-br from-primary/20 via-accent/10 to-primary/5 p-8 text-center sm:p-12">
        <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
          Ready to Take Control of Your Contracts?
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
          Join healthcare facilities and vendors already saving millions through
          better contract intelligence. Get started in minutes.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button size="lg" asChild>
            <Link href="/sign-up">
              Start Free Trial
              <ArrowRight className="ml-2 size-4" />
            </Link>
          </Button>
          <Button size="lg" variant="outline" asChild>
            <Link href="/login">Sign In</Link>
          </Button>
        </div>
      </div>
    </section>
  )
}
