import type { Metadata } from "next"
import { Mail, MessageSquare, Building2 } from "lucide-react"
import { ContactForm } from "@/components/marketing/contact-form"

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Get in touch with the TYDEi team about contract management, rebates, and onboarding for your facility or vendor organization.",
  alternates: { canonical: "/contact" },
}

export default function ContactPage() {
  return (
    <div className="container mx-auto max-w-5xl px-4 py-16 md:py-24">
      <header className="mb-12 max-w-2xl">
        <h1 className="text-3xl font-bold tracking-tight text-balance md:text-4xl">
          Let&rsquo;s talk
        </h1>
        <p className="mt-4 text-lg text-muted-foreground">
          Whether you&rsquo;re a facility looking to tame contract administration or
          a vendor managing rebate programs, we&rsquo;d love to hear from you. Send a
          note and our team will get back to you within one business day.
        </p>
      </header>

      <div className="grid gap-12 md:grid-cols-[1fr_320px]">
        <div>
          <ContactForm />
        </div>

        <aside className="space-y-6">
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Mail className="size-5" aria-hidden="true" />
            </span>
            <div>
              <h2 className="font-semibold">Email us</h2>
              <p className="text-sm text-muted-foreground">
                Prefer email? Reach us directly at{" "}
                <a
                  href="mailto:support@tydei.com"
                  className="text-primary underline underline-offset-4"
                >
                  support@tydei.com
                </a>
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <MessageSquare className="size-5" aria-hidden="true" />
            </span>
            <div>
              <h2 className="font-semibold">Support</h2>
              <p className="text-sm text-muted-foreground">
                Existing customers can also reach support from inside the platform
                via the help menu.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Building2 className="size-5" aria-hidden="true" />
            </span>
            <div>
              <h2 className="font-semibold">Facilities &amp; vendors</h2>
              <p className="text-sm text-muted-foreground">
                Tell us which side you&rsquo;re on and what you&rsquo;re hoping to
                streamline so we can point you to the right place.
              </p>
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}
